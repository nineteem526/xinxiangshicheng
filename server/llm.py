import json
import os
import re

import httpx

SYSTEM = """你是游戏关卡设计师。根据现实物品生成一个"现实入侵"小游戏关卡。
只输出一个 JSON 对象,不要任何解释或代码块。字段(全部必填,中文):
object: 物品名(<=12字)
fantasyName: 游戏中的身份名(<=14字)
theme: 世界风格(<=12字)
mission: 任务一句话(<=40字)
story: 背景故事(<=120字)
duration: 整数 30-90
difficulty: 1、2 或 3
weakness: 只能是 "Open_Palm"、"Closed_Fist"、"Victory" 之一(攻击感用 Closed_Fist,防御感用 Open_Palm,封印/施法感用 Victory)
accent: 只能是 "#00f0ff" "#ff2bd6" "#7dff6b" "#ffb300" "#ff4d4d" 之一
lines: {"start":..., "success":..., "failure":...} 各<=40字
身份和玩法必须贴合物品本身的特征,不要套用同一段剧情。"""

SCENE_SYSTEM = """你是游戏关卡设计师。画面是一张真实桌面,上面有若干现实物品。它们正在被异世界"入侵",每件物品都是一个入侵点。
只输出一个 JSON 对象,不要任何解释或代码块。字段(全部必填,中文):
theme: 世界风格(<=12字)
mission: 任务一句话(<=40字)
story: 背景故事,把这些物品串成一个事件(<=120字)
duration: 整数 30-90
difficulty: 1、2 或 3
accent: 只能是 "#00f0ff" "#ff2bd6" "#7dff6b" "#ffb300" "#ff4d4d" 之一
lines: {"start":..., "success":..., "failure":...} 各<=40字
rifts: 数组,1到4个,画面里最显眼的现实物品,每个:
  object: 物品名(<=12字,互不相同)
  fantasyName: 它在异世界的身份(<=14字,贴合物品特征)
  weakness: 只能是 "Open_Palm"、"Closed_Fist"、"Victory" 之一
  trait: 这件物品的打法,只能是下列之一,根据物品的特征选,且同一张桌面上尽量不要重复:
    "barrier" 带护盾,要先用张开手掌打碎(适合书、盒子、带盖子的东西)
    "charge" 要连续出拳蓄力才造成大伤害(适合杯子、瓶子、电池类容器)
    "phase" 只在周期性窗口打开时才能被打到(适合手机、屏幕、灯)
    "combo" 要限时连续命中,断了会回血(适合键盘、按键类)
    "plain" 普通,直接打(没有明显特征时用)
  box: [ymin,xmin,ymax,xmax],0-1000 归一化坐标,ymin/xmin 为左上角,框要紧贴物品
忽略人手和桌面本身。"""


class LLMError(Exception):
    pass


def config() -> dict:
    return {
        "base_url": os.getenv("LLM_BASE_URL", "").rstrip("/"),
        "api_key": os.getenv("LLM_API_KEY", ""),
        "model": os.getenv("LLM_MODEL", ""),
        "vision": os.getenv("LLM_VISION", "false").lower() == "true",
        "timeout": float(os.getenv("LLM_TIMEOUT", "20")),
    }


def configured() -> bool:
    c = config()
    return bool(c["base_url"] and c["api_key"] and c["model"])


def extract_json(text: str) -> dict:
    m = re.search(r"\{.*\}", text.strip(), re.S)
    if not m:
        raise LLMError("模型未返回 JSON")
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError as e:
        raise LLMError(f"JSON 解析失败: {e}") from e
    if not isinstance(data, dict):
        raise LLMError("JSON 不是对象")
    return data


def _chat(system: str, user, temperature: float) -> dict:
    c = config()
    if not configured():
        raise LLMError("后端未配置模型(server/.env)")
    body = {
        "model": c["model"],
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": temperature,
    }
    try:
        r = httpx.post(
            f"{c['base_url']}/chat/completions",
            json=body,
            headers={"Authorization": f"Bearer {c['api_key']}"},
            timeout=c["timeout"],
        )
        r.raise_for_status()
        content = r.json()["choices"][0]["message"]["content"]
    except httpx.TimeoutException as e:
        raise LLMError("模型请求超时") from e
    except (httpx.HTTPError, KeyError, IndexError, ValueError) as e:
        raise LLMError(f"模型请求失败: {type(e).__name__}") from e
    return extract_json(content if isinstance(content, str) else str(content))


def _image_user(text: str, image_data_url: str) -> list:
    if not config()["vision"]:
        raise LLMError("当前模型未启用图片输入,请使用手动输入物品名")
    return [{"type": "text", "text": text}, {"type": "image_url", "image_url": {"url": image_data_url}}]


def generate(object_name: str | None, image_data_url: str | None) -> dict:
    if image_data_url:
        user = _image_user("识别图中画面里最显眼的一件现实物品,并为它生成关卡。", image_data_url)
    else:
        user = f"现实物品:{object_name}"
    return _chat(SYSTEM, user, 0.8)


def generate_scene(image_data_url: str) -> dict:
    user = _image_user("找出桌面上的现实物品,为整张桌面生成一个关卡。", image_data_url)
    return _chat(SCENE_SYSTEM, user, 0.5)
