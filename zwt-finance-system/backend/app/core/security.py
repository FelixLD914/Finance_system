"""口令哈希与会话令牌原语。

口令派生用标准库 hashlib.scrypt，不引入第三方依赖：生产 Windows Server 上
不需要额外安装带 C 扩展的包，requirements.lock 也不必扩容。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import threading

from anyio import to_thread

# OWASP 口令存储指南把 scrypt N=2^17/r=8/p=1 与 N=2^16/r=8/p=2 列为等价工作量
# 配置：p 只乘时间、不乘内存。选后者，实测总耗时相同（~350 ms），但单次派生的
# 峰值内存从 128 MiB 降到 64 MiB。登录接口是未认证端点且没有速率限制，
# 内存占用越低越不容易被拿来做内存耗尽。
SCRYPT_N = 2**16
SCRYPT_R = 8
SCRYPT_P = 2
SCRYPT_SALT_BYTES = 16
SCRYPT_DK_LEN = 32

# hashlib.scrypt 底层是 OpenSSL，默认 maxmem 只有 32 MiB。不显式放宽的话，
# 任何超过 N=2^14 的参数都直接抛 "memory limit exceeded"，而不是变慢。
SCRYPT_MAXMEM = SCRYPT_N * SCRYPT_R * 256

# 单次派生占 64 MiB，WinSW 默认只跑一个 worker 进程。限流并发派生数把进程
# 峰值内存钉在 4 x 64 MiB 以内，否则并发登录请求可以直接把服务打到 OOM。
#
# 用 threading 而不是 asyncio/anyio 的信号量：派生本身在 to_thread 的工作线程里
# 跑，而 run_windows.py 会自建 SelectorEventLoop，模块级的 asyncio 原语容易踩
# "attached to a different loop"。threading 信号量与事件循环无关。
_KDF_CONCURRENCY = threading.BoundedSemaphore(4)

_PREFIX = "scrypt"


def _derive(password: str, salt: bytes, *, n: int, r: int, p: int) -> bytes:
    with _KDF_CONCURRENCY:
        return hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=n,
            r=r,
            p=p,
            dklen=SCRYPT_DK_LEN,
            maxmem=max(SCRYPT_MAXMEM, n * r * 256),
        )


def _b64encode(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def encode_password_hash(password: str) -> str:
    """把口令派生成 `scrypt$n$r$p$salt$hash`（同步版本，仅供迁移脚本/测试使用）。

    参数写进哈希串本身，日后调高强度不需要迁移：verify 按串里的参数校验，
    needs_rehash 负责识别出旧参数的记录。
    """
    salt = secrets.token_bytes(SCRYPT_SALT_BYTES)
    derived = _derive(password, salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P)
    return "$".join(
        [
            _PREFIX,
            str(SCRYPT_N),
            str(SCRYPT_R),
            str(SCRYPT_P),
            _b64encode(salt),
            _b64encode(derived),
        ]
    )


async def hash_password(password: str) -> str:
    """异步派生口令哈希。派生要 ~350 ms，必须挪出事件循环。"""
    return await to_thread.run_sync(encode_password_hash, password)


def verify_password_sync(password: str, encoded: str) -> bool:
    """按 encoded 里记录的参数校验口令。任何格式问题都返回 False，不抛异常。"""
    try:
        prefix, raw_n, raw_r, raw_p, raw_salt, raw_hash = encoded.split("$")
        if prefix != _PREFIX:
            return False
        n, r, p = int(raw_n), int(raw_r), int(raw_p)
        salt = base64.b64decode(raw_salt, validate=True)
        expected = base64.b64decode(raw_hash, validate=True)
    except (ValueError, TypeError):
        return False
    if not salt or not expected or n < 2 or r < 1 or p < 1:
        return False
    try:
        derived = _derive(password, salt, n=n, r=r, p=p)
    except ValueError:
        # 参数超出 OpenSSL 限制（例如被人为改坏的记录），当作校验失败。
        return False
    return hmac.compare_digest(derived, expected)


async def verify_password(password: str, encoded: str) -> bool:
    return await to_thread.run_sync(verify_password_sync, password, encoded)


def needs_rehash(encoded: str) -> bool:
    """encoded 是否用了比当前配置更弱的参数，登录成功后应顺带升级。"""
    try:
        prefix, raw_n, raw_r, raw_p, _, _ = encoded.split("$")
    except ValueError:
        return True
    if prefix != _PREFIX:
        return True
    try:
        return (int(raw_n), int(raw_r), int(raw_p)) != (SCRYPT_N, SCRYPT_R, SCRYPT_P)
    except ValueError:
        return True


# --- 会话令牌 -----------------------------------------------------------------
#
# 数据库里只存令牌的 SHA-256，不存原值。这样即使 core.sessions 被只读方式
# 读走（备份泄露、误开权限），拿到的摘要也无法反推出可用的 Cookie。
# 令牌是 32 字节的高熵随机值，不存在字典攻击面，所以摘要用 SHA-256 足够，
# 不需要 scrypt 这类慢哈希 —— 每个请求都要查会话，慢哈希会拖垮整体延迟。

SESSION_TOKEN_BYTES = 32


def new_session_token() -> tuple[str, str]:
    """返回 (原始令牌, 令牌摘要)。原始值只发给浏览器一次，服务端只留摘要。"""
    token = secrets.token_urlsafe(SESSION_TOKEN_BYTES)
    return token, hash_session_token(token)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
