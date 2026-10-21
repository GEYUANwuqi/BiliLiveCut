"""邮件传输与非阻塞通知出口的边界回归。"""

from __future__ import annotations

import asyncio
import smtplib
import threading
from dataclasses import replace
from email import policy
from email.parser import BytesParser
from socketserver import StreamRequestHandler, ThreadingTCPServer

import pytest

from app.core.configuration import ConfigurationChange, save_configuration
from app.notify import mail


def test_plain_smtp_uses_real_loopback_transport():
    recipients, messages = [], []

    class Handler(StreamRequestHandler):
        def handle(self):
            self.wfile.write(b"220 test SMTP\r\n")
            while line := self.rfile.readline():
                command = line.decode().strip()
                if command.upper().startswith("EHLO"):
                    self.wfile.write(b"250 test\r\n")
                elif command.upper().startswith("MAIL"):
                    self.wfile.write(b"250 OK\r\n")
                elif command.upper().startswith("RCPT"):
                    recipients.append(command)
                    self.wfile.write(b"250 OK\r\n")
                elif command.upper() == "DATA":
                    self.wfile.write(b"354 continue\r\n")
                    data = []
                    while (chunk := self.rfile.readline()) != b".\r\n":
                        data.append(chunk)
                    messages.append(BytesParser(policy=policy.default).parsebytes(b"".join(data)))
                    self.wfile.write(b"250 queued\r\n")
                elif command.upper() == "QUIT":
                    self.wfile.write(b"221 bye\r\n")
                    return

    with ThreadingTCPServer(("127.0.0.1", 0), Handler) as server:
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        try:
            config = mail.MailConfig(
                "127.0.0.1", server.server_address[1], "plain", "", "", "sender@invalid.test", "owner@invalid.test"
            )
            mail.transmit(config, "邮箱验证", "验证码：123456")
        finally:
            server.shutdown()
            thread.join(5)
    assert len(recipients) == 1
    command, address = recipients[0].split(":", 1)
    assert command.casefold() == "rcpt to"
    assert address == "<owner@invalid.test>"
    assert str(messages[0]["Subject"]) == "邮箱验证"
    assert "验证码：123456" in messages[0].get_content()


@pytest.mark.parametrize("security", ["ssl", "starttls", "plain"])
def test_smtp_security_and_explicit_recipient(monkeypatch, security):
    calls = []

    class SMTP:
        def __init__(self, host, port, **kwargs):
            calls.append(("connect", host, port, "context" in kwargs))

        def ehlo(self):
            calls.append("ehlo")

        def starttls(self, **kwargs):
            calls.append("starttls")

        def login(self, user, password):
            calls.append(("login", user, password))

        def send_message(self, message, **kwargs):
            calls.append(("send", str(message["To"]), kwargs))
            return {}

        def quit(self):
            calls.append("quit")

    monkeypatch.setattr(mail.smtplib, "SMTP", SMTP)
    monkeypatch.setattr(mail.smtplib, "SMTP_SSL", SMTP)
    config = mail.MailConfig(
        "smtp.invalid", 465, security, "sender@invalid.test", "password", "sender@invalid.test", "target@invalid.test"
    )
    mail.transmit(config, "subject", "body")
    assert calls[0][-1] is (security == "ssl")
    assert ("starttls" in calls) is (security == "starttls")
    if security == "starttls":
        assert calls.index("starttls") < calls.index(("login", config.user, config.password))
    assert calls[-2][2]["to_addrs"] == [config.recipient]
    assert "password" not in repr(config)


def test_smtp_errors_never_echo_raw_credentials(monkeypatch):
    def failure(*args, **kwargs):
        raise smtplib.SMTPAuthenticationError(535, b"private-password 123456")

    monkeypatch.setattr(mail.smtplib, "SMTP_SSL", failure)
    config = mail.MailConfig(
        "smtp.invalid", 465, "ssl", "sender@invalid.test", "password", "sender@invalid.test", "target@invalid.test"
    )
    with pytest.raises(mail.MailError) as caught:
        mail.transmit(config, "subject", "body")
    assert "private-password" not in str(caught.value) and "123456" not in str(caught.value)
    with pytest.raises(mail.MailError):
        mail.transmit(replace(config, recipient="a@test.invalid,b@test.invalid"), "subject", "body")


async def test_mail_queue_does_not_block_event_loop_and_merges_pending(temp_db, monkeypatch):
    from app.notify import delivery

    save_configuration(
        ConfigurationChange(
            values={"notify_enabled": True, "smtp_host": "smtp.invalid", "smtp_to": "target@invalid.test"}
        )
    )
    entered, release = threading.Event(), threading.Event()
    calls = []

    def delayed(*args, **kwargs):
        entered.set()
        release.wait(3)
        calls.append(kwargs["alert_key"])
        return True

    monkeypatch.setattr(delivery, "send_verified_email", delayed)
    await delivery.start_email_delivery()
    try:
        delivery.publish_connection_alert(1, "cookie_expired")
        assert await asyncio.to_thread(entered.wait, 1)
        delivery.publish_connection_alert(1, "cookie_expired")
        await asyncio.wait_for(asyncio.sleep(0), timeout=0.1)
    finally:
        release.set()
        await delivery.stop_email_delivery()
    assert calls == ["bilibili:1:cookie_expired"]


async def test_cookie_failure_and_repeated_ws_failure_emit_distinct_alerts(monkeypatch):
    from app.notify import delivery
    from app.plugins.live_source import DanmakuStatus
    from app.sources.bilibili.client import BilibiliRateLimitError, HttpErrorType
    from app.sources.bilibili.danmaku import DanmakuConnection

    events = []
    monkeypatch.setattr(delivery, "publish_connection_alert", lambda *args: events.append(args))
    connection = DanmakuConnection(1, "DedeUserID=1; SESSDATA=stale;")
    connection._record_login_failure(BilibiliRateLimitError(HttpErrorType.COOKIE_EXPIRED, "expired"))
    assert events == [(1, "cookie_expired")]
    for _ in range(2):
        await connection._report_state(DanmakuStatus.FAILED)
    assert len(events) == 1
    await connection._report_state(DanmakuStatus.FAILED)
    assert events[-1] == (1, "ws_failed")
    await connection._report_state(DanmakuStatus.AVAILABLE)
    await connection._report_state(DanmakuStatus.FAILED)
    assert len(events) == 2
