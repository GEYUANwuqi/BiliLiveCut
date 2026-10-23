"""日志日期查询的边界、时区和数量限制。"""

from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture()
def logs_client(temp_db):
    from app.db.entities import SystemLog
    from app.db.session import get_session
    from app.web.routers.logs import router

    with get_session() as db:
        db.add_all(
            [
                SystemLog(level="ERROR", message="前一天", created_at=datetime(2026, 10, 21, 15, 59, 59)),
                SystemLog(level="WARNING", message="当天起点", created_at=datetime(2026, 10, 21, 16)),
                SystemLog(level="ERROR", message="当天较新", created_at=datetime(2026, 10, 22, 15, 59, 59)),
                SystemLog(level="ERROR", message="次日起点", created_at=datetime(2026, 10, 22, 16)),
            ]
            + [
                SystemLog(
                    level="ERROR", message=f"后续日志 {i}", created_at=datetime(2026, 10, 23) + timedelta(seconds=i)
                )
                for i in range(501)
            ]
        )
        db.commit()
    app = FastAPI()
    app.include_router(router, prefix="/api")
    with TestClient(app) as client:
        yield client


@pytest.mark.parametrize(
    ("start", "end"),
    [
        ("2026-10-22T00:00:00+08:00", "2026-10-23T00:00:00+08:00"),
        ("2026-10-21T16:00:00Z", "2026-10-22T16:00:00Z"),
        ("2026-10-21T16:00:00", "2026-10-22T16:00:00"),
    ],
)
def test_date_filter_queries_history_before_applying_limit(logs_client, start, end):
    response = logs_client.get("/api/logs", params={"start_at": start, "end_at": end, "limit": 500})
    assert response.status_code == 200
    assert [row["message"] for row in response.json()] == ["当天较新", "当天起点"]
    response = logs_client.get("/api/logs", params={"start_at": start, "end_at": end, "level": "WARNING", "limit": 1})
    assert [row["message"] for row in response.json()] == ["当天起点"]


def test_unfiltered_logs_keep_the_limit_and_latest_first(logs_client):
    response = logs_client.get("/api/logs", params={"limit": 1000})
    assert response.status_code == 200
    assert len(response.json()) == 500
    assert response.json()[0]["message"] == "后续日志 500"
    assert response.json()[-1]["message"] == "后续日志 1"


@pytest.mark.parametrize(
    ("params", "status"),
    [
        ({"start_at": "invalid"}, 422),
        ({"end_at": "invalid"}, 422),
        ({"start_at": "2026-10-22T00:00:00Z", "end_at": "2026-10-21T00:00:00Z"}, 400),
        ({"start_at": "2026-10-22T08:00:00+08:00", "end_at": "2026-10-22T00:00:00Z"}, 400),
    ],
)
def test_log_date_query_rejects_invalid_intervals(logs_client, params, status):
    assert logs_client.get("/api/logs", params=params).status_code == status
