import base64

import pytest

from app.core.security import (
    SCRYPT_MAXMEM,
    SCRYPT_N,
    SCRYPT_P,
    SCRYPT_R,
    encode_password_hash,
    hash_session_token,
    needs_rehash,
    new_session_token,
    verify_password_sync,
)


def test_hash_round_trips_and_rejects_wrong_password() -> None:
    encoded = encode_password_hash("correct horse battery staple")

    assert verify_password_sync("correct horse battery staple", encoded)
    assert not verify_password_sync("Correct horse battery staple", encoded)
    assert not verify_password_sync("", encoded)


def test_hash_is_salted_so_equal_passwords_differ() -> None:
    first = encode_password_hash("same-password")
    second = encode_password_hash("same-password")

    assert first != second
    assert verify_password_sync("same-password", first)
    assert verify_password_sync("same-password", second)


def test_hash_records_its_own_parameters() -> None:
    # 参数写进哈希串，才能在不迁移数据的前提下调高强度。
    prefix, n, r, p, salt, digest = encode_password_hash("whatever").split("$")

    assert prefix == "scrypt"
    assert (int(n), int(r), int(p)) == (SCRYPT_N, SCRYPT_R, SCRYPT_P)
    assert len(base64.b64decode(salt)) == 16
    assert len(base64.b64decode(digest)) == 32


def test_maxmem_is_raised_above_openssl_default() -> None:
    # hashlib.scrypt 走 OpenSSL，默认 maxmem 只有 32 MiB，不显式放宽的话
    # 当前参数会直接抛 "memory limit exceeded"。这条守住那个前提。
    assert SCRYPT_MAXMEM >= SCRYPT_N * SCRYPT_R * 128


@pytest.mark.parametrize(
    "encoded",
    [
        "",
        "not-a-hash",
        "scrypt$65536$8",
        "bcrypt$65536$8$2$AAAA$AAAA",
        "scrypt$abc$8$2$AAAA$AAAA",
        "scrypt$65536$8$2$!!!$AAAA",
        "scrypt$1$8$2$AAAA$AAAA",
    ],
)
def test_malformed_hashes_fail_closed(encoded: str) -> None:
    # 任何格式异常都必须返回 False，不能抛异常 —— 抛出去就是 500，
    # 而 500 与 401 的差异可以被用来探测数据状态。
    assert verify_password_sync("anything", encoded) is False


def test_needs_rehash_flags_foreign_and_weaker_hashes() -> None:
    assert needs_rehash("") is True
    assert needs_rehash("bcrypt$1$1$1$AAAA$AAAA") is True
    assert needs_rehash("scrypt$1024$8$1$AAAA$AAAA") is True
    assert needs_rehash(encode_password_hash("current-params")) is False


def test_session_token_is_stored_only_as_a_digest() -> None:
    token, digest = new_session_token()

    assert token != digest
    assert digest == hash_session_token(token)
    assert len(digest) == 64
    # 原始令牌不能出现在摘要里，否则库泄露就等于会话泄露。
    assert token not in digest


def test_session_tokens_do_not_repeat() -> None:
    tokens = {new_session_token()[0] for _ in range(50)}

    assert len(tokens) == 50
