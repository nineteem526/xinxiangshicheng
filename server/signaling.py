"""Pairing + WebRTC signalling for the "phone as camera" link.

The backend stays bound to 127.0.0.1. A phone only ever reaches it through the frontend dev proxy,
which stamps X-Forwarded-For. Anything that arrives with a non-loopback source is "remote" and may
do exactly one thing: join a room with a valid 6-digit code. Video itself never touches this server;
it flows phone -> PC over WebRTC. We only relay small, whitelisted SDP/ICE messages.
"""
import ipaddress
import json
import math
import secrets
import socket
import time

from fastapi import WebSocket

MAX_MSG_CHARS = 64 * 1024
MAX_FAILS = 10  # wrong codes allowed per window before joins are refused
FAIL_WINDOW_S = 60.0


def is_loopback(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip.strip())
    except ValueError:
        return False
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return addr.is_loopback


def is_remote(headers, client_host: str) -> bool:
    """True when the real peer is not this machine. The proxy appends the true peer last."""
    xff = headers.get("x-forwarded-for")
    ip = xff.split(",")[-1] if xff else client_host
    return not is_loopback(ip or "")


def lan_ips() -> list[str]:
    """IPv4 addresses a phone could reach. Windows hotspot (192.168.137.x) is listed first."""
    found: list[str] = []
    try:  # the interface that owns the default route; no packet is sent
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        found.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.append(info[4][0])
    except OSError:
        pass
    out: list[str] = []
    for ip in found:
        a = ipaddress.ip_address(ip)
        if a.is_loopback or a.is_link_local or a.is_unspecified or ip in out:
            continue
        out.append(ip)
    out.sort(key=lambda ip: 0 if ip.startswith("192.168.137.") else 1)
    return out


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _caps(d: dict) -> dict | None:
    """Phone -> PC: what zoom range and lenses this phone's browser exposes."""
    z = d.get("zoom")
    zoom = None
    if z is not None:
        if not isinstance(z, dict) or not all(_num(z.get(k)) for k in ("min", "max", "step")):
            return None
        zoom = {k: float(z[k]) for k in ("min", "max", "step")}
    value = d.get("value")
    lenses = d.get("lenses")
    if not isinstance(lenses, list) or len(lenses) > 8:
        return None
    out = []
    for item in lenses:
        if not isinstance(item, dict):
            return None
        i, label = item.get("id"), item.get("label")
        if not isinstance(i, str) or not isinstance(label, str) or len(i) > 256 or len(label) > 80:
            return None
        out.append({"id": i, "label": label})
    lens_id = d.get("lensId")
    return {
        "type": "caps",
        "zoom": zoom,
        "value": float(value) if _num(value) else None,
        "lenses": out,
        "lensId": lens_id if isinstance(lens_id, str) and len(lens_id) <= 256 else None,
    }


def _set(d: dict) -> dict | None:
    """PC -> phone: change zoom or switch lens. Nothing else can be commanded."""
    out: dict = {"type": "set"}
    if "zoom" in d:
        z = d["zoom"]
        if not _num(z) or not 0.1 <= z <= 20:
            return None
        out["zoom"] = float(z)
    if "lens" in d:
        lens = d["lens"]
        if not isinstance(lens, str) or not 0 < len(lens) <= 256:
            return None
        out["lens"] = lens
    return out if len(out) > 1 else None


def sanitize(raw: str) -> dict | None:
    """Parse and rebuild a signalling message from known fields only. None = drop."""
    if len(raw) > MAX_MSG_CHARS:
        return None
    try:
        d = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(d, dict):
        return None
    t = d.get("type")
    if t in ("offer", "answer"):
        sdp = d.get("sdp")
        return {"type": t, "sdp": sdp} if isinstance(sdp, str) and sdp else None
    if t == "ice":
        c = d.get("candidate")
        if c is None:
            return {"type": "ice", "candidate": None}
        if not isinstance(c, dict) or not isinstance(c.get("candidate"), str):
            return None
        mid = c.get("sdpMid")
        idx = c.get("sdpMLineIndex")
        return {
            "type": "ice",
            "candidate": {
                "candidate": c["candidate"],
                "sdpMid": mid if isinstance(mid, str) else None,
                "sdpMLineIndex": idx if isinstance(idx, int) else None,
            },
        }
    if t == "caps":
        return _caps(d)
    if t == "set":
        return _set(d)
    if t == "meta":
        f = d.get("facing")
        return {"type": "meta", "facing": f} if f in ("user", "environment") else None
    return None


class Room:
    def __init__(self, code: str, host: WebSocket):
        self.code = code
        self.host = host
        self.phone: WebSocket | None = None


class Rooms:
    def __init__(self):
        self.rooms: dict[str, Room] = {}
        self.fails: list[float] = []

    def create(self, host: WebSocket) -> Room:
        while True:
            code = f"{secrets.randbelow(10**6):06d}"
            if code not in self.rooms:
                break
        room = Room(code, host)
        self.rooms[code] = room
        return room

    def remove(self, room: Room) -> None:
        if self.rooms.get(room.code) is room:
            del self.rooms[room.code]

    def get(self, code: str) -> Room | None:
        return self.rooms.get(code)

    def limited(self) -> bool:
        now = time.monotonic()
        self.fails = [t for t in self.fails if now - t < FAIL_WINDOW_S]
        return len(self.fails) >= MAX_FAILS

    def fail(self) -> None:
        self.fails.append(time.monotonic())


rooms = Rooms()
