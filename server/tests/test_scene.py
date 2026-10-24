import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from fastapi.testclient import TestClient  # noqa: E402

import llm  # noqa: E402
from main import app  # noqa: E402

IMG = "data:image/jpeg;base64,AAAA"
RIFT = {"object": "水杯", "fantasyName": "量子核心", "weakness": "Closed_Fist", "box": [180, 80, 330, 190]}
SCENE = {
    "theme": "赛博科幻", "mission": "封印所有入侵点", "story": "桌面上的物品正在被改写。",
    "duration": 60, "difficulty": 2, "accent": "#00f0ff",
    "lines": {"start": "a", "success": "b", "failure": "c"},
    "rifts": [RIFT, {**RIFT, "object": "手机", "fantasyName": "次元通讯器", "weakness": "Open_Palm", "box": [220, 280, 370, 360]}],
}
c = TestClient(app, client=("127.0.0.1", 50000))


class SceneT(unittest.TestCase):
    def test_scene_flattens_to_level_with_rifts(self):
        with patch.object(llm, "generate_scene", return_value=dict(SCENE)):
            r = c.post("/api/scene", json={"image": IMG}).json()
        self.assertTrue(r["ok"], r)
        lv = r["level"]
        self.assertEqual(lv["source"], "ai")
        self.assertEqual(len(lv["rifts"]), 2)
        self.assertEqual(lv["weakness"], "Closed_Fist")
        self.assertEqual(lv["object"], "水杯、手机")
        self.assertEqual(lv["rifts"][1]["box"], [220, 280, 370, 360])

    def test_scene_rejects_bad_rifts(self):
        bads = [
            {"rifts": []},
            {"rifts": [RIFT] * 5},
            {"rifts": [RIFT, RIFT]},  # duplicate object
            {"rifts": [{**RIFT, "box": [0, 0, 10, 10]}]},  # too small
            {"rifts": [{**RIFT, "box": [0, 0, 1200, 500]}]},  # out of range
            {"rifts": [{**RIFT, "weakness": "Thumb_Up"}]},
            {"rifts": [{**RIFT, "hp": 50}]},  # extra field
        ]
        for bad in bads:
            with patch.object(llm, "generate_scene", return_value={**SCENE, **bad}):
                self.assertFalse(c.post("/api/scene", json={"image": IMG}).json()["ok"], bad)

    def test_scene_errors(self):
        self.assertFalse(c.post("/api/scene", json={"image": "nope"}).json()["ok"])
        with patch.object(llm, "generate_scene", side_effect=llm.LLMError("模型请求超时")):
            self.assertEqual(c.post("/api/scene", json={"image": IMG}).json()["error"], "模型请求超时")
        env = {"LLM_BASE_URL": "http://x", "LLM_API_KEY": "k", "LLM_MODEL": "m", "LLM_VISION": "false"}
        with patch.dict(os.environ, env):
            self.assertIn("手动", c.post("/api/scene", json={"image": IMG}).json()["error"])


if __name__ == "__main__":
    unittest.main()
