import json
import re

from dotenv import load_dotenv
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

load_dotenv()

import llm  # noqa: E402
import signaling  # noqa: E402
from schema import validate_level, validate_scene  # noqa: E402

app = FastAPI(title="RealityGlitch")

# A phone on the LAN reaches us only through the frontend proxy. It may pair; it may not generate
# levels (that spends the API key) or read config. Fail closed: everything except /api/link/join.
REMOTE_ALLOWED = ("/api/link/join",)


@app.middleware("http")
async def block_remote(request: Request, call_next):
    if signaling.is_remote(request.headers, request.client.host if request.client else "") and not request.url.path.startswith(REMOTE_ALLOWED):
        return JSONResponse({"ok": False, "error": "仅限本机访问"}, status_code=403)
    return await call_next(request)

MAX_IMAGE_CHARS = 2_000_000
IMG_RE = re.compile(r"^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$")


class LevelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    image: str | None = Field(default=None, max_length=MAX_IMAGE_CHARS)
    object: str | None = Field(default=None, min_length=1, max_length=12)


class SceneRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    image: str = Field(max_length=MAX_IMAGE_CHARS)


@app.get("/api/health")
def health():
    c = llm.config()
    return {"configured": llm.configured(), "vision": llm.configured() and c["vision"]}


@app.post("/api/level")
def make_level(req: LevelRequest):
    """Always HTTP 200 for generation problems. ok=false means the client falls back to a preset."""
    if not req.image and not req.object:
        return {"ok": False, "error": "需要图片或物品名"}
    if req.image and not IMG_RE.match(req.image):
        return {"ok": False, "error": "图片格式无效"}
    source = "ai" if req.image else "manual"
    try:
        raw = llm.generate(None if req.image else req.object, req.image)
        if source == "manual":
            raw["object"] = req.object  # keep the user's own wording
        level = validate_level(raw, source)
    except llm.LLMError as e:
        return {"ok": False, "error": str(e)}
    except ValidationError:
        return {"ok": False, "error": "模型返回的关卡未通过校验"}
    return {"ok": True, "level": level}


@app.post("/api/scene")
def make_scene(req: SceneRequest):
    """Whole-table scan: one call returns a level with 1..4 rifts anchored to real objects."""
    if not IMG_RE.match(req.image):
        return {"ok": False, "error": "图片格式无效"}
    try:
        level = validate_scene(llm.generate_scene(req.image))
    except llm.LLMError as e:
        return {"ok": False, "error": str(e)}
    except ValidationError:
        return {"ok": False, "error": "模型返回的场景未通过校验"}
    return {"ok": True, "level": level}


@app.get("/api/link/info")
def link_info():
    """Local only (middleware). LAN addresses the big screen shows in the QR code."""
    return {"ips": signaling.lan_ips()}


async def _pump(src: WebSocket, get_dst) -> None:
    """Relay one message. The destination is resolved after the message arrives, because the phone
    may join (or leave) while the host is already waiting."""
    raw = await src.receive_text()
    msg = signaling.sanitize(raw)
    dst = get_dst()
    if msg is not None and dst is not None:
        await dst.send_text(json.dumps(msg))


@app.websocket("/api/link/host")
async def link_host(ws: WebSocket):
    """The PC: creates a room and receives the phone's offer / ICE."""
    if signaling.is_remote(ws.headers, ws.client.host if ws.client else ""):
        await ws.close(code=4403)
        return
    await ws.accept()
    room = signaling.rooms.create(ws)
    await ws.send_text(json.dumps({"type": "room", "code": room.code}))
    try:
        while True:
            await _pump(ws, lambda: room.phone)
    except WebSocketDisconnect:
        pass
    finally:
        signaling.rooms.remove(room)
        if room.phone is not None:
            try:
                await room.phone.close(code=4000)
            except RuntimeError:
                pass


@app.websocket("/api/link/join")
async def link_join(ws: WebSocket, code: str = ""):
    """A phone: joins the room by 6-digit code (rate-limited)."""
    await ws.accept()
    room = signaling.rooms.get(code) if re.fullmatch(r"\d{6}", code) else None
    if signaling.rooms.limited() or room is None or room.phone is not None:
        if room is None:
            signaling.rooms.fail()
        await ws.close(code=4404)
        return
    room.phone = ws
    await room.host.send_text(json.dumps({"type": "joined"}))
    try:
        while True:
            await _pump(ws, lambda: room.host)
    except WebSocketDisconnect:
        pass
    finally:
        if room.phone is ws:
            room.phone = None
        try:
            await room.host.send_text(json.dumps({"type": "left"}))
        except Exception:
            pass
