"""飞书通知只使用 HTTP API，测试隔离网络、凭据、冷却与管理权限。"""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.configuration import ConfigurationChange, save_configuration
from app.notify import lark


@pytest.fixture
def lark_setup(monkeypatch):
    monkeypatch.setattr(settings, "lark_app_id", "cli_test")
    monkeypatch.setattr(settings, "lark_app_secret", "private-app-secret")
    monkeypatch.setattr(settings, "lark_receive_id", "oc_test")
    monkeypatch.setattr(settings, "notify_enabled", True)
    monkeypatch.setattr(lark, "_cached_token", None)
    requests = []
    replies = [
        {"code": 0, "tenant_access_token": "private-access-token", "expire": 7200},
        {"code": 0, "data": {"message_id": "om_test"}},
    ]
    factory = httpx.Client

    def handle(request):
        requests.append(request)
        reply = replies.pop(0)
        return httpx.Response(200, json=reply)

    monkeypatch.setattr(lark.httpx, "Client", lambda **kwargs: factory(transport=httpx.MockTransport(handle), **kwargs))
    return requests, replies


@pytest.mark.parametrize("domain,host", [("feishu", "open.feishu.cn"), ("lark", "open.larksuite.com")])
def test_lark_app_auth_text_format_and_token_reuse(lark_setup, monkeypatch, domain, host):
    requests, replies = lark_setup
    monkeypatch.setattr(settings, "lark_domain", domain)
    monkeypatch.setattr(settings, "lark_receive_id_type", "open_id")
    assert lark.send_lark("运行提醒", "WS 连接失败") is True
    assert len(requests) == 2
    auth, message = requests
    assert auth.url.host == message.url.host == host
    assert auth.url.path == "/open-apis/auth/v3/tenant_access_token/internal"
    assert json.loads(auth.content) == {"app_id": "cli_test", "app_secret": "private-app-secret"}
    assert message.url.params["receive_id_type"] == "open_id"
    assert message.headers["Authorization"] == "Bearer private-access-token"
    payload = json.loads(message.content)
    assert payload["receive_id"] == "oc_test" and payload["msg_type"] == "text"
    assert json.loads(payload["content"]) == {"text": "运行提醒\n\nWS 连接失败"}
    assert payload["uuid"]
    replies.append({"code": 0})
    assert lark.send_lark("再次提醒", "body") is True
    assert len(requests) == 3 and requests[-1].url.path == "/open-apis/im/v1/messages"
    assert json.loads(requests[-1].content)["uuid"] != payload["uuid"]


def test_credentials_change_and_expiry_refresh_token(lark_setup, monkeypatch):
    requests, replies = lark_setup
    assert lark.send_lark("title", "body")
    replies.extend([{"code": 0, "tenant_access_token": "next-token", "expire": 1}, {"code": 0}])
    monkeypatch.setattr(settings, "lark_app_secret", "changed-secret")
    assert lark.send_lark("title", "body")
    assert json.loads(requests[-2].content)["app_secret"] == "changed-secret"
    replies.extend([{"code": 0, "tenant_access_token": "third-token", "expire": 7200}, {"code": 0}])
    assert lark.send_lark("title", "body")
    assert len(requests) == 6


@pytest.mark.parametrize("reply", [{"code": 1, "msg": "private-app-secret"}, [], {"code": 0}])
def test_invalid_auth_cannot_send_message_or_log_response(lark_setup, reply):
    requests, replies = lark_setup
    replies[:] = [reply]
    messages = []
    sink = lark.logger.add(messages.append, format="{message}")
    try:
        assert lark.send_lark("title", "body") is False
    finally:
        lark.logger.remove(sink)
    assert len(requests) == 1
    assert "private-app-secret" not in "".join(messages)


def test_message_rejection_invalidates_cached_token(lark_setup):
    _, replies = lark_setup
    replies[1] = {"code": 230002, "msg": "private-access-token"}
    assert lark.send_lark("title", "body") is False
    assert lark._cached_token is None


def test_incomplete_lark_settings_never_contact_network(lark_setup, monkeypatch):
    requests, _ = lark_setup
    monkeypatch.setattr(settings, "lark_receive_id", "")
    assert not lark.configured() and not lark.send_lark("title", "body")
    assert requests == []


def test_lark_connection_cooldown_is_persistent_and_honors_rules(temp_db, lark_setup, monkeypatch):
    sent = []
    monkeypatch.setattr(lark, "send_lark", lambda *args: sent.append(args) or True)
    assert lark.send_connection_alert("WS", "body", "room:1")
    assert not lark.send_connection_alert("WS", "body", "room:1")
    assert lark.send_connection_alert("WS", "body", "room:2")
    monkeypatch.setattr(settings, "notify_on_connection", False)
    assert not lark.send_connection_alert("WS", "body", "room:3")
    assert len(sent) == 2


async def test_connection_alert_uses_lark_without_smtp(temp_db, lark_setup, monkeypatch):
    from app.notify import delivery

    sent = []
    monkeypatch.setattr(settings, "smtp_host", "")
    monkeypatch.setattr(lark, "send_connection_alert", lambda *args: sent.append(args) or True)
    await delivery.start_email_delivery()
    try:
        delivery.publish_connection_alert(42, "cookie_expired")
    finally:
        await delivery.stop_email_delivery()
    assert len(sent) == 1 and sent[0][-1] == "bilibili:42:cookie_expired"


def test_lark_configuration_masks_secret_and_test_requires_admin_and_same_origin(temp_db, monkeypatch):
    from app.web import main
    from app.web.routers import lark_notifications

    sent = []
    monkeypatch.setattr(lark_notifications, "send_lark", lambda *args: sent.append(args) or True)
    client = TestClient(main.app, base_url="http://127.0.0.1")
    response = client.patch(
        "/api/settings/configuration",
        json={"values": {"lark_app_id": "cli_test", "lark_app_secret": "private-secret", "lark_receive_id": "oc_test"}},
    )
    assert response.status_code == 200, response.text
    response = client.get("/api/settings/configuration")
    fields = {field["key"]: field for field in response.json()["fields"]}
    assert fields["lark_app_secret"]["configured"] and fields["lark_app_secret"]["secret"]
    assert fields["lark_receive_id"]["group"] == "notifications"
    assert "private-secret" not in response.text and not sent
    save_configuration(ConfigurationChange(values={"lark_app_secret": ""}))
    assert lark.configured()
    endpoint = "/api/settings/notifications/lark/test"
    monkeypatch.setattr(main, "_ADMIN_PASSWORD", "admin-pass")
    monkeypatch.setattr(main, "_REVIEWER_PASSWORDS", {"reviewer": "review-pass"})
    assert client.post(endpoint).status_code == 401
    assert client.post(endpoint, auth=("reviewer", "review-pass")).status_code == 403
    assert (
        client.post(endpoint, auth=("admin", "admin-pass"), headers={"Origin": "https://evil.invalid"}).status_code
        == 403
    )
    assert not sent
    assert client.post(endpoint, auth=("admin", "admin-pass")).status_code == 200
    assert len(sent) == 1
