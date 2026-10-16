"""独立前端服务的真实 HTTP 代理与静态路由契约。"""

from __future__ import annotations

import http.client
import threading
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from app.web.frontend_server import FrontendHandler


@pytest.fixture
def gateway(tmp_path: Path):
    (tmp_path / "index.html").write_text("<main>react app</main>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "main.js").write_text("console.log('ok')")
    observed: list[dict] = []

    class Backend(BaseHTTPRequestHandler):
        def do_GET(self):
            observed.append({"path": self.path, "headers": self.headers})
            body = b"video" if "video" in self.path else b'{"ok":true}'
            self.send_response(206 if "video" in self.path else 200)
            self.send_header("Content-Type", "video/mp4" if "video" in self.path else "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Set-Cookie", "session=opaque; HttpOnly; Path=/")
            if "video" in self.path:
                self.send_header("Content-Range", "bytes 0-4/100")
            self.end_headers()
            self.wfile.write(body)

        def do_PUT(self):
            if self.headers.get("Transfer-Encoding") == "chunked":
                chunks = []
                while size := int(self.rfile.readline(), 16):
                    chunks.append(self.rfile.read(size))
                    assert self.rfile.read(2) == b"\r\n"
                assert self.rfile.read(2) == b"\r\n"
                body = b"".join(chunks)
            else:
                body = self.rfile.read(int(self.headers["Content-Length"]))
            observed.append({"body": body, "headers": self.headers})
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"{}")

        def log_message(self, *args):
            pass

    backend = ThreadingHTTPServer(("127.0.0.1", 0), Backend)
    frontend = ThreadingHTTPServer(
        ("127.0.0.1", 0),
        partial(FrontendHandler, directory=tmp_path, backend=f"http://127.0.0.1:{backend.server_port}"),
    )
    for server in (backend, frontend):
        threading.Thread(target=server.serve_forever, daemon=True).start()
    yield frontend.server_port, observed
    for server in (frontend, backend):
        server.shutdown()
        server.server_close()


def request(port, path, method="GET", body=None, headers=None, **kwargs):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    conn.request(method, path, body=body, headers=headers or {}, **kwargs)
    response = conn.getresponse()
    result = response.status, dict(response.getheaders()), response.read()
    conn.close()
    return result


def test_spa_and_assets_have_separate_cache_and_fallback_rules(gateway):
    port, _ = gateway
    assert request(port, "/settings/configuration")[2] == b"<main>react app</main>"
    assert request(port, "/review/123")[0] == 200
    assert request(port, "/collection/1")[0] == 200
    assert request(port, "/assets/missing.js")[0] == 404
    assert request(port, "/unknown")[0] == 404
    assert request(port, "/%2e%2e/secret")[0] == 404
    assert request(port, "/")[1]["Cache-Control"] == "no-store"
    assert "immutable" in request(port, "/assets/main.js")[1]["Cache-Control"]


def test_proxy_preserves_media_range_auth_csrf_and_cookies(gateway):
    port, observed = gateway
    status, headers, body = request(
        port,
        "/api/clips/1/video",
        headers={
            "Host": "localhost:8080",
            "Range": "bytes=0-4",
            "Authorization": "Basic test",
            "X-Forwarded-For": "evil",
        },
    )
    assert status == 206 and body == b"video"
    assert headers["Content-Range"] == "bytes 0-4/100"
    assert "HttpOnly" in headers["Set-Cookie"]
    forwarded = observed[-1]["headers"]
    assert forwarded["Host"] == "localhost:8080"
    assert forwarded["Authorization"] == "Basic test"
    assert forwarded["Range"] == "bytes=0-4"
    assert forwarded["X-Forwarded-For"] == "127.0.0.1"


@pytest.mark.parametrize("chunked", [False, True])
def test_import_upload_streams_without_losing_request_body(gateway, chunked):
    port, observed = gateway
    body = b"large video payload" * 10000
    headers = {"Origin": "http://localhost:8080", "X-BLC-CSRF": "csrf-token"}
    source = iter([body[:50000], body[50000:]]) if chunked else body
    assert (
        request(port, "/api/recording-imports/abc/files/video", "PUT", source, headers, encode_chunked=chunked)[0]
        == 200
    )
    assert observed[-1]["body"] == body
    assert observed[-1]["headers"]["Origin"] == "http://localhost:8080"
    assert observed[-1]["headers"]["X-BLC-CSRF"] == "csrf-token"
