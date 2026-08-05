"""工资预支单上盖谁的章：取值顺序与"不许静默换人"。

业务背景（validation._resolve_signer_codes 已经把这条口径写死了）：总经理有两个人
（龚尧文 MD_GONG_YAOWEN / 朱发坚 MD_ZHU_FAJIAN），导入时宁可整行报错也不猜。
所以文档生成这一侧同样不能猜——猜错就是在一张有效力的审批单上盖了另一个人的章，
金额、日期、格式全都正常，事后极难发现。

这里测两层：
- rank_role_signatures：纯函数，"哪些能盖 / 谁优先"。
- _resolve_signature：取值顺序本身，用一个只回放预设结果的假 session 驱动。
  单元测试不连数据库（见 conftest），所以假 session 是唯一能覆盖顺序的办法。
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from app.modules.salary_advance.document_service import (
    SalaryAdvanceDocumentService,
    declared_modules,
    rank_role_signatures,
)
from app.modules.salary_advance.service import SalaryAdvanceStateError

FINANCE_USAGE = "salary_advance_finance"
MD_USAGE = "salary_advance_md"


@dataclass
class FakeAsset:
    """够 rank_role_signatures / signature_allows / _with_path 用的最小签名资产。"""

    name: str
    usage: str
    version: int = 1
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    storage_key: str = "signatures/stub.png"
    sha256: str = "0" * 64
    signer_name: str | None = None
    scale_percent: int = 100


# ── 纯函数层 ────────────────────────────────────────────────────────────────


def test_declared_modules_does_not_expand_roles() -> None:
    """字面声明 != 能盖范围。通用签名盖得了财务位，但它不是"专门的财务签名"。"""
    assert declared_modules("salary_advance") == {"salary_advance"}
    assert declared_modules("salary_advance_finance,wht") == {
        "salary_advance_finance",
        "wht",
    }
    assert declared_modules(None) == set()


def test_rank_drops_signatures_that_cannot_stamp_the_role() -> None:
    wht_only = FakeAsset("WHT_ONLY", "wht")
    md_only = FakeAsset("MD_GONG_YAOWEN", MD_USAGE)
    finance = FakeAsset("FIN_XING_LANHUI", FINANCE_USAGE)
    ranked = rank_role_signatures([wht_only, md_only, finance], FINANCE_USAGE)
    assert [a.name for a in ranked] == ["FIN_XING_LANHUI"]


def test_role_specific_outranks_generic_salary_advance() -> None:
    """老的通用签名还能用，但用户一旦配了角色专属的，就该由专属的胜出。

    不这么排的话，用户按新口径维护完角色签名会发现"改了没生效"。
    """
    generic = FakeAsset("LEGACY_GENERIC", "salary_advance")
    specific = FakeAsset("FIN_XING_LANHUI", FINANCE_USAGE)
    assert [a.name for a in rank_role_signatures([generic, specific], FINANCE_USAGE)] == [
        "FIN_XING_LANHUI",
        "LEGACY_GENERIC",
    ]
    # 只有通用的时候，通用的仍然可用——这是给角色化之前的数据留的退路。
    assert [a.name for a in rank_role_signatures([generic], MD_USAGE)] == [
        "LEGACY_GENERIC"
    ]


def test_rank_is_stable_within_the_same_tier() -> None:
    """同档次内保持调用方给的顺序（按版本/创建时间已排好），不要再打乱。"""
    newer = FakeAsset("MD_GONG_YAOWEN", MD_USAGE, version=3)
    older = FakeAsset("MD_GONG_YAOWEN", MD_USAGE, version=1)
    assert [a.version for a in rank_role_signatures([newer, older], MD_USAGE)] == [3, 1]


# ── 取值顺序 ────────────────────────────────────────────────────────────────


class _Scalars:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return self._rows


class FakeSession:
    """按调用次序回放预设结果，并记录每次查的是什么，用来断言"根本没去查默认签名"。"""

    def __init__(
        self,
        *,
        by_id: Any = None,
        by_code: list[Any] | None = None,
        defaults: list[Any] | None = None,
    ) -> None:
        self.by_id = by_id
        self.by_code = by_code or []
        self.defaults = defaults or []
        self.calls: list[str] = []

    async def scalar(self, _statement: Any) -> Any:
        self.calls.append("by_id")
        return self.by_id

    async def scalars(self, statement: Any) -> _Scalars:
        # 只看 WHERE 子句。不能看 str(statement)：整条 SELECT 会把
        # signature_assets 的**所有列名**渲染进去，其中就有 is_default，
        # 于是两个查询都会被判成"查默认签名"——假 session 静默走错分支，
        # 测试看起来在测顺序，实际两条路径都没覆盖到。
        where = str(statement.whereclause)
        which = "defaults" if "is_default" in where else "by_code"
        self.calls.append(which)
        return _Scalars(self.defaults if which == "defaults" else self.by_code)


@dataclass
class FakeRecord:
    normalized_data: dict[str, Any]


def build_service(session: FakeSession, tmp_path: Path) -> SalaryAdvanceDocumentService:
    class _Settings:
        attachment_root = tmp_path

    service = SalaryAdvanceDocumentService(session, "测试人", _Settings())  # type: ignore[arg-type]
    return service


@pytest.fixture
def signature_file(tmp_path: Path) -> Path:
    path = tmp_path / "signatures" / "stub.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"not-a-real-png-but-_with_path-only-checks-existence")
    return path


def resolve(service: Any, record: Any, role: str, signature_id: Any = None) -> Any:
    """同步驱动待测协程。

    刻意不用 @pytest.mark.anyio：这套后端里没有别的 async 测试，也没把 async 插件
    写进 dev 依赖（anyio 只是 fastapi 的传递依赖）。插件哪天不在了，带 marker 的
    async 测试会被当成"没跑"而静默跳过——一个永远绿的测试比没有测试更糟。
    asyncio.run 没有这个问题：跑不起来就是报错。
    """
    return asyncio.run(
        service._resolve_signature(record, role, signature_id=signature_id)
    )


def test_row_signature_code_beats_the_global_default(
    tmp_path: Path,
    signature_file: Path,
) -> None:
    """这是这次修复的核心：逐行代码必须压过默认签名。

    原实现反着来，于是签名库里只要有一张默认签名，导入文件里逐行写的
    md_signature_code 就永远读不到——两个总经理的单子会全部盖成同一个人。
    """
    row_signature = FakeAsset("MD_ZHU_FAJIAN", MD_USAGE)
    default_signature = FakeAsset("MD_GONG_YAOWEN", MD_USAGE)
    session = FakeSession(by_code=[row_signature], defaults=[default_signature])
    service = build_service(session, tmp_path)
    record = FakeRecord({"md_signature_code": "MD_ZHU_FAJIAN"})

    resolved = resolve(service, record, "md")

    assert resolved.asset.name == "MD_ZHU_FAJIAN"
    assert "defaults" not in session.calls, "命中逐行代码后就不该再去查默认签名"


def test_falls_back_to_default_only_when_the_row_says_nothing(
    tmp_path: Path,
    signature_file: Path,
) -> None:
    default_signature = FakeAsset("FIN_XING_LANHUI", FINANCE_USAGE)
    session = FakeSession(defaults=[default_signature])
    service = build_service(session, tmp_path)

    resolved = resolve(service, FakeRecord({}), "finance")

    assert resolved.asset.name == "FIN_XING_LANHUI"
    assert session.calls == ["defaults"]


def test_named_code_with_no_usable_signature_raises_instead_of_substituting(
    tmp_path: Path,
) -> None:
    """指名了签名人却找不到那张签名时，退回默认签名 == 盖成另一个人，必须报错。"""
    session = FakeSession(by_code=[], defaults=[FakeAsset("MD_GONG_YAOWEN", MD_USAGE)])
    service = build_service(session, tmp_path)
    record = FakeRecord({"md_signature_code": "MD_ZHU_FAJIAN"})

    with pytest.raises(SalaryAdvanceStateError) as error:
        resolve(service, record, "md")
    assert "MD_ZHU_FAJIAN" in str(error.value)
    assert "defaults" not in session.calls


def test_code_pointing_at_a_wrong_scope_signature_raises(
    tmp_path: Path,
) -> None:
    """同名签名存在，但适用范围里没有这个角色位——一样不能拿来盖。"""
    session = FakeSession(by_code=[FakeAsset("MD_ZHU_FAJIAN", "wht")])
    service = build_service(session, tmp_path)
    record = FakeRecord({"md_signature_code": "MD_ZHU_FAJIAN"})

    with pytest.raises(SalaryAdvanceStateError):
        resolve(service, record, "md")


def test_no_default_raises_instead_of_grabbing_any_active_signature(
    tmp_path: Path,
) -> None:
    """原实现的第 4 步兜底（全库最新 active）已删除。

    那一步会在指定签名被停用时静默换成别人的签名；宁可让这批开不出来。
    """
    session = FakeSession(defaults=[])
    service = build_service(session, tmp_path)

    with pytest.raises(SalaryAdvanceStateError) as error:
        resolve(service, FakeRecord({}), "finance")
    assert "财务负责人" in str(error.value)


def test_explicit_selection_wins_over_everything(
    tmp_path: Path,
    signature_file: Path,
) -> None:
    chosen = FakeAsset("FIN_XING_LANHUI", FINANCE_USAGE)
    session = FakeSession(
        by_id=chosen,
        by_code=[FakeAsset("FIN_OTHER", FINANCE_USAGE)],
        defaults=[FakeAsset("FIN_DEFAULT", FINANCE_USAGE)],
    )
    service = build_service(session, tmp_path)
    record = FakeRecord({"finance_signature_code": "FIN_OTHER"})

    resolved = resolve(service, record, "finance", signature_id=chosen.id)

    assert resolved.asset.name == "FIN_XING_LANHUI"
    assert session.calls == ["by_id"]


def test_explicit_selection_that_is_gone_raises_instead_of_degrading(
    tmp_path: Path,
) -> None:
    """选定的签名被停用/删除时不能悄悄换一张——否则"让用户选签名"就是假功能。"""
    session = FakeSession(by_id=None, defaults=[FakeAsset("FIN_DEFAULT", FINANCE_USAGE)])
    service = build_service(session, tmp_path)

    with pytest.raises(SalaryAdvanceStateError) as error:
        resolve(service, FakeRecord({}), "finance", signature_id=uuid.uuid4())
    assert "重新选择" in str(error.value)
    assert "defaults" not in session.calls


def test_explicit_selection_outside_the_role_scope_raises(
    tmp_path: Path,
) -> None:
    wrong_scope = FakeAsset("WHT_SIGNER", "wht")
    session = FakeSession(by_id=wrong_scope)
    service = build_service(session, tmp_path)

    with pytest.raises(SalaryAdvanceStateError) as error:
        resolve(service, FakeRecord({}), "md", signature_id=wrong_scope.id)
    assert "适用范围" in str(error.value)


# ── 打印姓名跟着签名章走 ─────────────────────────────────────────────────────


def snapshot(service: Any, record: Any, **kwargs: Any) -> Any:
    return asyncio.run(service._snapshot(record, **kwargs))


def test_printed_name_comes_from_the_signature_not_the_imported_row(
    tmp_path: Path,
    signature_file: Path,
) -> None:
    """这是加 signer_name 的全部意义：印的名字与盖的章不可能是两个人。

    以前姓名取自导入行、章取自签名解析链，两者可以对不上而系统拦不住。
    现在 _snapshot 用签名资产的 signer_name 覆盖掉导入行里的那两列。
    """
    finance = FakeAsset("FIN_XING_LANHUI", FINANCE_USAGE, signer_name="邢兰慧")
    md = FakeAsset("MD_ZHU_FAJIAN", MD_USAGE, signer_name="朱发坚")
    session = FakeSession(by_code=[finance, md], defaults=[])
    service = build_service(session, tmp_path)
    record = FakeRecord(
        {
            # 导入行里写的是另外两个人——不该出现在单据上。
            "finance_display_name": "张三",
            "md_display_name": "李四",
            "finance_signature_code": "FIN_XING_LANHUI",
            "md_signature_code": "MD_ZHU_FAJIAN",
        }
    )

    result = snapshot(service, record)

    assert result.normalized_data["finance_display_name"] == "邢兰慧"
    assert result.normalized_data["md_display_name"] == "朱发坚"
    # 原始导入数据不受影响，仍可追溯。
    assert record.normalized_data["md_display_name"] == "李四"


def test_signer_name_is_recorded_in_the_manifest(
    tmp_path: Path,
    signature_file: Path,
) -> None:
    """事后要能回答"这张单子上印的名字是谁"，光有资产 id 对不上账。"""
    md = FakeAsset("MD_GONG_YAOWEN", MD_USAGE, signer_name="龚尧文")
    finance = FakeAsset("FIN_XING_LANHUI", FINANCE_USAGE, signer_name="邢兰慧")
    # _snapshot 两个角色都要解析：总经理走逐行代码，财务走默认签名。
    session = FakeSession(by_code=[md], defaults=[finance, md])
    service = build_service(session, tmp_path)

    result = snapshot(service, FakeRecord({"md_signature_code": "MD_GONG_YAOWEN"}))

    assert result.md_signature_version["signerName"] == "龚尧文"
    assert result.finance_signature_version["signerName"] == "邢兰慧"


def test_each_position_carries_its_own_saved_scale(
    tmp_path: Path,
    signature_file: Path,
) -> None:
    """签名库维护页存的 scale_percent 必须跟着各自那张章走到出票。

    加这条之前，工资预支是三种单据里唯一把它整个丢掉的：WHT 与 TAX INV 的
    document_service 都传了 signature.scale_percent，这里没传，于是维护页弹
    "已成功将签名缩放效果应用保存至系统开票"，工资预支单出来纹丝不动。
    两个位常是两个人的章、各调各的尺寸，所以必须分开取——合成一个值就等于
    让董事的章跟着财务的比例走。
    """
    finance = FakeAsset("FIN_XING_LANHUI", FINANCE_USAGE, signer_name="邢兰慧", scale_percent=80)
    md = FakeAsset("MD_ZHU_FAJIAN", MD_USAGE, signer_name="朱发坚", scale_percent=135)
    session = FakeSession(by_code=[finance, md], defaults=[])
    service = build_service(session, tmp_path)
    record = FakeRecord(
        {
            "finance_signature_code": "FIN_XING_LANHUI",
            "md_signature_code": "MD_ZHU_FAJIAN",
        }
    )

    result = snapshot(service, record)

    assert result.finance_scale_percent == 80
    assert result.md_scale_percent == 135
