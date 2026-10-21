"""管理员显式测试已保存的飞书通知配置。"""

from fastapi import APIRouter, HTTPException

from app.notify.lark import send_lark

router = APIRouter(prefix="/settings/notifications/lark", tags=["lark_notifications"])


@router.post("/test")
def test_lark_notification() -> dict[str, bool]:
    """保存不会发信；仅此管理员操作发送固定测试消息。"""
    if not send_lark("BiliLiveCut 通知测试", "飞书消息通道已连通。此消息由设置页面的测试发送操作触发。"):
        raise HTTPException(400, "飞书测试未送达，请检查应用凭据、服务区域、机器人权限及接收对象。")
    return {"ok": True}
