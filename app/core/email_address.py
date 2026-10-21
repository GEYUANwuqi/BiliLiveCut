"""单个邮箱地址校验，不接受显示名、地址列表或邮件头注入。"""

from email.headerregistry import Address


def mailbox(value: str) -> str:
    """返回规范地址；空值用于尚未配置的邮件服务。"""
    value = value.strip()
    if not value:
        return ""
    try:
        if len(value) > 254 or any(ord(char) < 33 or ord(char) > 126 for char in value):
            raise ValueError
        address = Address(addr_spec=value)
        if not address.username or not address.domain or address.addr_spec != value:
            raise ValueError
    except (ValueError, IndexError) as exc:
        raise ValueError("请输入单个有效邮箱地址，不包含显示名或地址列表") from exc
    return f"{address.username}@{address.domain.lower()}"
