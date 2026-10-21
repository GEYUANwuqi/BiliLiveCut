"""字幕导入使用实际流式限制，兼容新版 FastAPI 的文件参数。"""

import pytest
from fastapi.testclient import TestClient
from sqlmodel import select


@pytest.mark.parametrize("extra_bytes", [0, 1])
def test_ass_import_enforces_one_mib_before_creating_templates(temp_db: None, extra_bytes: int) -> None:
    from app.db.entities import SubtitleTemplate
    from app.db.session import get_session
    from app.web.main import app

    style = (
        b"[V4+ Styles]\n"
        b"Style: Uploaded,Arial,36,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,"
        b"0,0,0,0,100,100,0,0,1,2,2,2,20,20,20,1\n;"
    )
    payload = style + b"x" * (1_048_576 + extra_bytes - len(style))
    with TestClient(app) as client:
        with get_session() as db:
            before = len(db.exec(select(SubtitleTemplate)).all())
        response = client.post("/api/templates/import/ass", files={"file": ("style.ass", payload, "text/plain")})
        assert response.status_code == (413 if extra_bytes else 200), response.text
        if not extra_bytes:
            assert response.json()["imported"][0]["name"] == "Uploaded"
        with get_session() as db:
            assert len(db.exec(select(SubtitleTemplate)).all()) == before + (0 if extra_bytes else 1)
