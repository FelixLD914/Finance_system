"""TAX INV 批量开具的编排：选票范围、单张失败的隔离、签名的快速失败。

单元测试不连数据库（见 conftest），所以这里用假 session + 打桩的
generate_documents 来测编排本身——真正落盘出票的那段已经由
test_tax_invoice_document_generator.py 覆盖，不重复。

要盯住的三件事：
1. invoice_ids 为空时只开「已批准且还没开」的，不能顺手把已开具的重开一遍
   （重开会多出一版文件，得由人点名）。
2. 一张开不出来不能拖垮整批——200 张里坏 1 张不该让另外 199 张重来。
3. 签名不可用是整批性问题，必须开跑前就失败，而不是回报 200 条相同的 skipped。
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from typing import Any

import pytest

from app.modules.tax_invoice.document_service import (
    BatchGenerateOutcome,
    TaxInvoiceDocumentService,
)
from app.modules.tax_invoice.schemas import BatchGenerateDocumentsRequest
from app.modules.tax_invoice.service import (
    TaxInvoiceNotFoundError,
    TaxInvoiceStateError,
)


@dataclass
class FakeInvoice:
    document_no: str
    id: uuid.UUID = field(default_factory=uuid.uuid4)


class _Scalars:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return self._rows


class FakeSession:
    def __init__(self, *, batch: Any, invoices: list[FakeInvoice]) -> None:
        self._batch = batch
        self._invoices = invoices
        #: 查询里绑定的全部字面值。断言状态过滤要看这个而不是 str(whereclause)——
        #: SQLAlchemy 把值渲染成 :status_1 这样的占位符，SQL 文本里根本没有
        #: "approved"，照文本断言会得到一条永远为假、看起来却在测东西的用例。
        self.bound_values: list[str] = []

    async def get(self, _model: Any, _pk: Any) -> Any:
        return self._batch

    async def scalars(self, statement: Any) -> _Scalars:
        values: list[str] = []
        for value in statement.compile().params.values():
            if isinstance(value, (list, tuple)):
                values.extend(str(item) for item in value)
            else:
                values.append(str(value))
        self.bound_values = values
        return _Scalars(self._invoices)


class _Settings:
    pass


def build_service(session: Any) -> TaxInvoiceDocumentService:
    return TaxInvoiceDocumentService(session, "测试出票人", _Settings())  # type: ignore[arg-type]


def run(coro: Any) -> Any:
    """同步驱动待测协程——不用 async marker，理由见
    test_salary_advance_signature_resolution.resolve 的注释。"""
    return asyncio.run(coro)


def stub_generation(
    service: TaxInvoiceDocumentService,
    *,
    failures: dict[uuid.UUID, Exception] | None = None,
    documents_per_invoice: int = 2,
) -> list[uuid.UUID]:
    """把真正出票那一步换掉，只记录被调用的顺序。返回该列表供断言。"""
    called: list[uuid.UUID] = []
    failures = failures or {}

    async def fake_generate(invoice_id: uuid.UUID, _payload: Any) -> list[object]:
        called.append(invoice_id)
        if invoice_id in failures:
            raise failures[invoice_id]
        return [object()] * documents_per_invoice

    async def fake_signature(_payload: Any) -> tuple[None, None]:
        return None, None

    service.generate_documents = fake_generate  # type: ignore[method-assign]
    service._resolve_generation_signature = fake_signature  # type: ignore[method-assign]
    return called


def test_missing_batch_raises_not_found() -> None:
    service = build_service(FakeSession(batch=None, invoices=[]))
    stub_generation(service)
    with pytest.raises(TaxInvoiceNotFoundError):
        run(service.generate_documents_for_batch(uuid.uuid4(), BatchGenerateDocumentsRequest()))


def test_empty_invoice_ids_targets_approved_only() -> None:
    """不点名时只开「已批准」的，已开具的不重开。"""
    invoices = [FakeInvoice("ZWT-2601-001"), FakeInvoice("ZWT-2601-002")]
    session = FakeSession(batch=object(), invoices=invoices)
    service = build_service(session)
    called = stub_generation(service)

    outcome = run(
        service.generate_documents_for_batch(uuid.uuid4(), BatchGenerateDocumentsRequest())
    )

    assert "approved" in session.bound_values
    assert "issued" not in session.bound_values, "不点名时不该把已开具的一起重开"
    assert called == [invoice.id for invoice in invoices]
    assert outcome.generated_invoice_ids == [invoice.id for invoice in invoices]
    assert outcome.document_count == 4  # 每张 xlsx + pdf
    assert outcome.skipped == []


def test_explicit_invoice_ids_allow_reissuing_already_issued() -> None:
    """点了名就按单张端点的语义来，已开具的允许重开。"""
    invoices = [FakeInvoice("ZWT-2601-003")]
    session = FakeSession(batch=object(), invoices=invoices)
    service = build_service(session)
    stub_generation(service)

    run(
        service.generate_documents_for_batch(
            uuid.uuid4(),
            BatchGenerateDocumentsRequest(invoice_ids=[invoices[0].id]),
        )
    )

    assert "issued" in session.bound_values


def test_one_bad_invoice_does_not_block_the_rest() -> None:
    good_a, bad, good_b = (
        FakeInvoice("ZWT-2601-010"),
        FakeInvoice("ZWT-2601-011"),
        FakeInvoice("ZWT-2601-012"),
    )
    service = build_service(
        FakeSession(batch=object(), invoices=[good_a, bad, good_b])
    )
    called = stub_generation(
        service,
        failures={bad.id: TaxInvoiceStateError("客户地址为空")},
    )

    outcome = run(
        service.generate_documents_for_batch(uuid.uuid4(), BatchGenerateDocumentsRequest())
    )

    assert called == [good_a.id, bad.id, good_b.id], "坏的那张之后必须继续开"
    assert outcome.generated_invoice_ids == [good_a.id, good_b.id]
    assert outcome.document_count == 4
    assert outcome.skipped == [(bad.id, "ZWT-2601-011", "客户地址为空")]


def test_skipped_carries_the_document_number_for_the_ui() -> None:
    """界面上要能直接说"哪一号票没开出来"，只给 uuid 用户对不上账。"""
    bad = FakeInvoice("ZWT-2601-020")
    service = build_service(FakeSession(batch=object(), invoices=[bad]))
    stub_generation(service, failures={bad.id: TaxInvoiceStateError("超过 18 行")})

    outcome = run(
        service.generate_documents_for_batch(uuid.uuid4(), BatchGenerateDocumentsRequest())
    )

    assert outcome.skipped[0][1] == "ZWT-2601-020"


def test_unusable_signature_fails_the_whole_batch_up_front() -> None:
    """签名不可用是整批性问题：直接失败，而不是每张各撞一遍。"""
    invoices = [FakeInvoice("ZWT-2601-030"), FakeInvoice("ZWT-2601-031")]
    service = build_service(FakeSession(batch=object(), invoices=invoices))
    called = stub_generation(service)

    async def bad_signature(_payload: Any) -> tuple[None, None]:
        raise TaxInvoiceStateError("the selected signature is not approved for tax invoices")

    service._resolve_generation_signature = bad_signature  # type: ignore[method-assign]

    with pytest.raises(TaxInvoiceStateError):
        run(
            service.generate_documents_for_batch(
                uuid.uuid4(),
                BatchGenerateDocumentsRequest(include_signature=True),
            )
        )
    assert called == [], "签名有问题就不该已经开出去几张"


def test_no_eligible_invoice_is_an_empty_outcome_not_an_error() -> None:
    """整批都已开具时是"没什么可开的"，不是错误——界面照常显示 0。"""
    service = build_service(FakeSession(batch=object(), invoices=[]))
    stub_generation(service)

    outcome = run(
        service.generate_documents_for_batch(uuid.uuid4(), BatchGenerateDocumentsRequest())
    )

    assert outcome == BatchGenerateOutcome(
        generated_invoice_ids=[], document_count=0, skipped=[]
    )


def test_request_inherits_format_normalisation_from_the_single_endpoint() -> None:
    """批量与单张必须是同一套格式口径，不能各写各的。"""
    assert BatchGenerateDocumentsRequest().formats == ["xlsx", "pdf"]
    assert BatchGenerateDocumentsRequest(formats=["pdf", "pdf"]).formats == ["pdf"]
    assert BatchGenerateDocumentsRequest().invoice_ids is None
