import json
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from fastapi.testclient import TestClient  # noqa: E402

import llm  # noqa: E402
from main import app  # noqa: E402

GOOD = {
    "object": "水杯", "fantasyName": "量子能量核心", "theme": "赛博科幻",
    "mission": "稳定失控的能量核心", "story": "这是一枚不稳定的量子电池。",
    "duration": 60, "difficulty": 2, "weakness": "Closed_Fist", "accent": "#00f0ff",
    "lines": {"start": "a", "success": "b", "failure": "c"},
}
IMG = "data:image/jpeg;base64,AAAA"
c = TestClient(app, client=("127.0.0.1", 50000))


class T(unittest.TestCase):
    def test_manual_ok_and_model_cannot_set_source(self):
        with patch.object(llm, "generate", return_value={**GOOD, "source": "preset"}):
            self.assertFalse(c.post("/api/level", json={"object": "水杯"}).json()["ok"])
        with patch.object(llm, "generate", return_value=dict(GOOD)):
            r = c.post("/api/level", json={"object": "水杯"}).json()
        self.assertTrue(r["ok"])
        self.assertEqual(r["level"]["source"], "manual")

    def test_image_source_ai(self):
        with patch.object(llm, "generate", return_value=dict(GOOD)):
            r = c.post("/api/level", json={"image": IMG}).json()
        self.assertEqual(r["level"]["source"], "ai")

    def test_range_violations_rejected(self):
        for bad in ({"duration": 500}, {"difficulty": 5}, {"weakness": "Thumb_Up"},
                    {"accent": "#123456"}, {"story": "x" * 500}, {"mission": "<script>"}):
            with patch.object(llm, "generate", return_value={**GOOD, **bad}):
                r = c.post("/api/level", json={"object": "水杯"}).json()
            self.assertFalse(r["ok"], bad)

    def test_llm_error_reported(self):
        with patch.object(llm, "generate", side_effect=llm.LLMError("模型请求超时")):
            r = c.post("/api/level", json={"object": "水杯"}).json()
        self.assertEqual(r, {"ok": False, "error": "模型请求超时"})

    def test_bad_input(self):
        self.assertFalse(c.post("/api/level", json={}).json()["ok"])
        self.assertFalse(c.post("/api/level", json={"image": "http://x"}).json()["ok"])
        self.assertEqual(c.post("/api/level", json={"object": "x", "evil": 1}).status_code, 422)

    def test_unconfigured_and_vision_disabled(self):
        with patch.dict(os.environ, {"LLM_BASE_URL": "", "LLM_API_KEY": "", "LLM_MODEL": ""}):
            self.assertFalse(c.get("/api/health").json()["configured"])
            self.assertFalse(c.post("/api/level", json={"object": "杯"}).json()["ok"])
        env = {"LLM_BASE_URL": "http://x", "LLM_API_KEY": "k", "LLM_MODEL": "m", "LLM_VISION": "false"}
        with patch.dict(os.environ, env):
            r = c.post("/api/level", json={"image": IMG}).json()
        self.assertIn("手动", r["error"])

    def test_extract_json_with_fences(self):
        self.assertEqual(llm.extract_json("```json\n" + json.dumps(GOOD) + "\n```")["object"], "水杯")


if __name__ == "__main__":
    unittest.main()
