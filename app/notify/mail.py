"""SMTP 传输；只有收件验证流程和已验证通知入口可以调用。"""

from __future__ import annotations

import smtplib
import ssl
from dataclasses import dataclass, field
from datetime import UTC, datetime
from email.message import EmailMessage

from app.core.email_address import mailbox


class MailError(ValueError):
    """可公开的邮件错误，不包含服务器原始响应或认证信息。"""


@dataclass(frozen=True)
class MailConfig:
    """一次发信使用的配置快照，不显示密码。"""

    host: str
    port: int
    security: str
    user: str
    password: str = field(repr=False)
    sender: str
    recipient: str

    def validate(self) -> None:
        """发送前检查有效配置，支持无认证的内网中继。"""
        if not self.host or not self.recipient or not self.sender:
            raise MailError("请先保存 SMTP 服务器、发件人和目标邮箱")
        if self.security not in {"ssl", "starttls", "plain"} or not 1 <= self.port <= 65535:
            raise MailError("SMTP 连接方式或端口无效")
        try:
            mailbox(self.sender)
            mailbox(self.recipient)
        except ValueError:
            raise MailError("发件人与目标邮箱必须是单个有效邮箱地址") from None


def transmit(config: MailConfig, subject: str, body: str, *, html: bool = False) -> None:
    """发送一封邮件；超时有限，不将 QUIT 失败误认为已接受邮件未发送。"""
    config.validate()
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = config.sender
    message["To"] = config.recipient
    message["Date"] = datetime.now(UTC)
    message.set_content(body, subtype="html" if html else "plain")
    server = None
    try:
        if config.security == "ssl":
            server = smtplib.SMTP_SSL(config.host, config.port, timeout=10, context=ssl.create_default_context())
        else:
            server = smtplib.SMTP(config.host, config.port, timeout=10)
            if config.security == "starttls":
                server.ehlo()
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
        if config.user:
            server.login(config.user, config.password)
        refused = server.send_message(message, from_addr=config.sender, to_addrs=[config.recipient])
        if refused:
            raise MailError("邮件服务器拒绝接收，请检查目标邮箱")
    except smtplib.SMTPAuthenticationError:
        raise MailError("SMTP 认证失败，请检查用户名和邮箱授权码") from None
    except smtplib.SMTPNotSupportedError:
        raise MailError("SMTP 服务不支持所选加密或认证方式") from None
    except ssl.SSLError:
        raise MailError("SMTP 加密连接或证书校验失败") from None
    except (OSError, smtplib.SMTPException):
        raise MailError("邮件发送失败，请检查 SMTP 地址、端口、连接方式和服务状态") from None
    finally:
        if server is not None:
            try:
                server.quit()
            except (OSError, smtplib.SMTPException):
                try:
                    server.close()
                except OSError:
                    pass
