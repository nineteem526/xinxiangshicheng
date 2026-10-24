import json
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from fastapi.testclient import TestClient  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402

import signaling  # noqa: E402
from main import app  # noqa: E402


LAN = {"x-forwarded-for": "192.168.137.20"}


def refused(client, url, headers=None):
    """True if the server closes the socket right after accepting (a refused join)."""
    try:
        with client.websocket_connect(url, headers=headers or {}) as ws:
            ws.receive_json()
    except WebSocketDisconnect:
        return True
    return False


def local_client():
    return TestClient(app, client=("127.0.0.1", 50000))


class GuardT(unittest.TestCase):
    def setUp(self):
        signaling.rooms.rooms.clear()
        signaling.rooms.fails.clear()

    def test_is_remote(self):
        h = lambda v: {"x-forwarded-for": v} if v else {}  # noqa: E731
        self.assertFalse(signaling.is_remote(h(None), "127.0.0.1"))
        self.assertFalse(signaling.is_remote(h("127.0.0.1"), "127.0.0.1"))
        self.assertFalse(signaling.is_remote(h("::1"), "127.0.0.1"))
        self.assertTrue(signaling.is_remote(h("192.168.1.9"), "127.0.0.1"))
        # a spoofed leading entry cannot hide the real peer, which the proxy appends last
        self.assertTrue(signaling.is_remote(h("127.0.0.1, 192.168.1.9"), "127.0.0.1"))
        self.assertTrue(signaling.is_remote(h("::ffff:192.168.1.9"), "127.0.0.1"))
        self.assertTrue(signaling.is_remote(h("garbage"), "127.0.0.1"))  # unparsable -> fail closed

    def test_remote_cannot_spend_the_api_key_or_read_config(self):
        c = local_client()
        for path, method in (("/api/health", "get"), ("/api/link/info", "get")):
            r = getattr(c, method)(path, headers=LAN)
            self.assertEqual(r.status_code, 403, path)
        for path, body in (("/api/level", {"object": "杯"}), ("/api/scene", {"image": "data:image/jpeg;base64,AAAA"})):
            self.assertEqual(c.post(path, json=body, headers=LAN).status_code, 403, path)

    def test_local_still_works(self):
        c = local_client()
        self.assertEqual(c.get("/api/health").status_code, 200)
        self.assertEqual(c.get("/api/health", headers={"x-forwarded-for": "127.0.0.1"}).status_code, 200)
        self.assertIn("ips", c.get("/api/link/info").json())

    def test_remote_cannot_host(self):
        c = local_client()
        with self.assertRaises(WebSocketDisconnect):
            with c.websocket_connect("/api/link/host", headers=LAN):
                pass


class PairT(unittest.TestCase):
    def setUp(self):
        signaling.rooms.rooms.clear()
        signaling.rooms.fails.clear()

    def test_full_pairing_and_whitelisted_relay(self):
        c = local_client()
        with c.websocket_connect("/api/link/host") as host:
            code = host.receive_json()["code"]
            self.assertRegex(code, r"^\d{6}$")
            with c.websocket_connect(f"/api/link/join?code={code}", headers=LAN) as phone:
                self.assertEqual(host.receive_json(), {"type": "joined"})
                phone.send_text(json.dumps({"type": "offer", "sdp": "v=0...", "evil": "x"}))
                self.assertEqual(host.receive_json(), {"type": "offer", "sdp": "v=0..."})
                host.send_text(json.dumps({"type": "answer", "sdp": "v=0..."}))
                self.assertEqual(phone.receive_json(), {"type": "answer", "sdp": "v=0..."})
                phone.send_text(json.dumps({"type": "ice", "candidate": {"candidate": "candidate:1", "sdpMid": "0", "sdpMLineIndex": 0, "x": 1}}))
                self.assertEqual(host.receive_json()["candidate"], {"candidate": "candidate:1", "sdpMid": "0", "sdpMLineIndex": 0})
                # unknown / oversized / malformed messages are dropped, not relayed
                phone.send_text(json.dumps({"type": "run", "cmd": "calc"}))
                phone.send_text("not json")
                phone.send_text(json.dumps({"type": "offer", "sdp": "x" * (signaling.MAX_MSG_CHARS + 1)}))
                phone.send_text(json.dumps({"type": "meta", "facing": "environment"}))
                self.assertEqual(host.receive_json(), {"type": "meta", "facing": "environment"})
            self.assertEqual(host.receive_json(), {"type": "left"})

    def test_caps_and_set_are_validated(self):
        ok_caps = {"type": "caps", "zoom": {"min": 0.5, "max": 8, "step": 0.1}, "value": 0.5,
                   "lenses": [{"id": "a", "label": "超广角"}], "lensId": "a", "x": 1}
        got = signaling.sanitize(json.dumps(ok_caps))
        self.assertEqual(got["zoom"], {"min": 0.5, "max": 8.0, "step": 0.1})
        self.assertNotIn("x", got)
        self.assertIsNone(signaling.sanitize(json.dumps({**ok_caps, "zoom": {"min": "a", "max": 1, "step": 1}})))
        self.assertIsNone(signaling.sanitize(json.dumps({**ok_caps, "lenses": [{"id": "a" * 300, "label": "x"}]})))
        self.assertIsNone(signaling.sanitize(json.dumps({**ok_caps, "lenses": [{"id": "a", "label": "x"}] * 9})))
        self.assertIsNone(signaling.sanitize('{"type":"caps","zoom":{"min":NaN,"max":1,"step":1},"lenses":[]}'))
        self.assertEqual(signaling.sanitize(json.dumps({"type": "caps", "zoom": None, "lenses": []}))["zoom"], None)

        self.assertEqual(signaling.sanitize('{"type":"set","zoom":0.6,"evil":1}'), {"type": "set", "zoom": 0.6})
        self.assertEqual(signaling.sanitize('{"type":"set","lens":"abc"}'), {"type": "set", "lens": "abc"})
        for bad in ('{"type":"set"}', '{"type":"set","zoom":99}', '{"type":"set","zoom":0}', '{"type":"set","zoom":true}',
                    '{"type":"set","zoom":Infinity}', '{"type":"set","lens":""}', '{"type":"set","lens":5}'):
            self.assertIsNone(signaling.sanitize(bad), bad)

    def test_wrong_code_is_refused_and_rate_limited(self):
        c = local_client()
        with c.websocket_connect("/api/link/host") as host:
            host.receive_json()
            code = next(iter(signaling.rooms.rooms))
            wrong = "000000" if code != "000000" else "111111"
            for _ in range(signaling.MAX_FAILS):
                self.assertTrue(refused(c, f"/api/link/join?code={wrong}", LAN))
            # even the right code is refused while rate-limited
            self.assertTrue(refused(c, f"/api/link/join?code={code}", LAN))

    def test_one_phone_per_room_and_room_dies_with_host(self):
        c = local_client()
        with c.websocket_connect("/api/link/host") as host:
            code = host.receive_json()["code"]
            with c.websocket_connect(f"/api/link/join?code={code}", headers=LAN):
                host.receive_json()
                self.assertTrue(refused(c, f"/api/link/join?code={code}", LAN))
        self.assertEqual(signaling.rooms.rooms, {})

    def test_codes_must_be_six_digits(self):
        c = local_client()
        for bad in ("", "12345", "abcdef", "1234567", "12%20456"):
            signaling.rooms.fails.clear()
            self.assertTrue(refused(c, f"/api/link/join?code={bad}", LAN), bad)


if __name__ == "__main__":
    unittest.main()
