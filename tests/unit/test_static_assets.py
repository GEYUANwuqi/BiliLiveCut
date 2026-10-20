"""系统 MIME 映射污染时的真实静态资源 HTTP 回归。"""

from __future__ import annotations

import mimetypes
import threading
from functools import partial
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.web.frontend_server import FrontendHandler
from app.web.staticfiles import WebStaticFiles


@pytest.mark.parametrize(
    ("suffix", "expected"), [(".js", "text/javascript"), (".mjs", "text/javascript"), (".css", "text/css")]
)
def test_static_files_override_polluted_mime_and_keep_cache(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, suffix: str, expected: str
) -> None:
    mimetypes.init()
    monkeypatch.setitem(mimetypes.types_map, suffix, "text/plain")
    source = b"/* asset */"
    (tmp_path / f"asset{suffix}").write_bytes(source)
    app = FastAPI()
    app.mount("/static", WebStaticFiles(directory=tmp_path))
    with TestClient(app) as client:
        response = client.get(f"/static/asset{suffix}")
        assert response.status_code == 200
        assert response.content == source
        assert response.headers["content-type"] == f"{expected}; charset=utf-8"
        assert response.headers["x-content-type-options"] == "nosniff"
        head = client.head(f"/static/asset{suffix}")
        assert head.status_code == 200 and head.content == b""
        assert head.headers["content-type"] == response.headers["content-type"]
        part = client.get(f"/static/asset{suffix}", headers={"Range": "bytes=0-3"})
        assert part.status_code == 206 and part.content == source[:4]
        assert part.headers["content-type"] == response.headers["content-type"]
        cached = client.get(f"/static/asset{suffix}", headers={"If-None-Match": response.headers["etag"]})
        assert cached.status_code == 304
        assert cached.content == b""
        missing = client.get(f"/static/missing{suffix}")
        assert missing.status_code == 404
        assert missing.headers["content-type"] == "application/json"
        assert client.get("/static/%2e%2e/outside.js").status_code == 404
        (tmp_path / "image.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
        assert client.get("/static/image.svg").headers["content-type"] == "image/svg+xml"


def test_production_frontend_serves_scripts_and_styles_with_correct_mime(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    mimetypes.init()
    assets = tmp_path / "assets"
    assets.mkdir()
    for suffix in (".js", ".mjs", ".css"):
        monkeypatch.setitem(mimetypes.types_map, suffix, "text/plain")
        (assets / f"asset{suffix}").write_bytes(b"/* built asset */")
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0), partial(FrontendHandler, directory=tmp_path, backend="http://127.0.0.1:1")
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        for suffix, media_type in ((".js", "text/javascript"), (".mjs", "text/javascript"), (".css", "text/css")):
            connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
            try:
                connection.request("GET", f"/assets/asset{suffix}")
                response = connection.getresponse()
                assert response.status == 200
                assert response.getheader("Content-Type") == f"{media_type}; charset=utf-8"
                assert response.getheader("X-Content-Type-Options") == "nosniff"
                assert response.read() == b"/* built asset */"
            finally:
                connection.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
