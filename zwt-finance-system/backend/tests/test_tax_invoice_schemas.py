import pytest
from pydantic import ValidationError

from app.modules.tax_invoice.schemas import TaxInvoiceDocumentGenerateRequest


def test_document_request_defaults_to_xlsx_only() -> None:
    # TAX INV PDF 底版还没随应用发布，document_service 见到 "pdf" 就抛 422。
    # 默认值里一旦带上 "pdf"，不传 formats 的请求会百分之百失败。
    request = TaxInvoiceDocumentGenerateRequest()

    assert request.formats == ["xlsx"]


def test_document_request_keeps_pdf_as_a_valid_explicit_choice() -> None:
    # 底版制好后要能直接把 "pdf" 传进来，Literal 不能收窄。
    request = TaxInvoiceDocumentGenerateRequest(formats=["xlsx", "pdf"])

    assert request.formats == ["xlsx", "pdf"]


def test_document_request_deduplicates_formats() -> None:
    request = TaxInvoiceDocumentGenerateRequest(formats=["xlsx", "xlsx"])

    assert request.formats == ["xlsx"]


def test_document_request_requires_signature_id_when_signature_included() -> None:
    with pytest.raises(ValidationError, match="signatureId"):
        TaxInvoiceDocumentGenerateRequest(includeSignature=True)
