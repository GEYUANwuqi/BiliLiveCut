"""系统 MIME 映射污染时的真实静态资源 HTTP 回归。"""

from __future__ import annotations

import mimetypes
import threading
from functools import partial
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

from app.web.frontend_server import FrontendHandler


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
