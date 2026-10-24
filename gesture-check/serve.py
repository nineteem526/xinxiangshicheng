import http.server
import socketserver
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    # Force correct MIME types (Windows registry often serves .mjs/.js as text/plain)
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
        ".task": "application/octet-stream",
        ".html": "text/html; charset=utf-8",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", 8080), Handler) as httpd:
    print("Serving on http://localhost:8080  (Ctrl+C to stop)")
    httpd.serve_forever()
