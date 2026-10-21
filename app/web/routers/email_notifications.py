"""管理员邮件设置与收件验证码入口，同步处理器由 FastAPI 在线程中运行。"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.notify.email_verification import (
    VerificationError,
    confirm_verification,
    request_verification,
    verification_status,
)
from app.notify.mail import MailError

router = APIRouter(prefix="/settings/notifications/email", tags=["email_notifications"])


class VerifyEmailRequest(BaseModel):
    """验证码绑定服务端签发的当前挑战。"""

    model_config = ConfigDict(extra="forbid")
    challenge_id: str = Field(min_length=16, max_length=128)
    code: str = Field(pattern=r"^[0-9]{6}$", repr=False)


@router.get("")
def get_email_status() -> dict[str, object]:
    """查询验证状态，不公开凭据或验证码。"""
    return verification_status()


@router.post("/verification-code")
def send_verification_code() -> dict[str, object]:
    """向已保存的目标邮箱发送验证码，尚不允许发送运行提醒。"""
    try:
        return request_verification()
    except VerificationError as exc:
        raise HTTPException(exc.status_code, str(exc)) from None
    except MailError as exc:
        raise HTTPException(400, str(exc)) from None


@router.post("/verify")
def verify_email(body: VerifyEmailRequest) -> dict[str, object]:
    """验证一次性验证码后持久授权当前邮件配置。"""
    try:
        return confirm_verification(body.challenge_id, body.code)
    except VerificationError as exc:
        raise HTTPException(exc.status_code, str(exc)) from None
