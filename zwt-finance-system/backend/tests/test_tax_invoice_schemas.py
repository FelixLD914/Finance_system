import pytest
from pydantic import ValidationError

from app.modules.tax_invoice.schemas import TaxInvoiceDocumentGenerateRequest


def test_document_request_defaults_to_both_formats() -> None:
    # PDF 底版已随应用发布，不传 formats 时两种都出。
    request = TaxInvoiceDocumentGenerateRequest()

    assert request.formats == ["xlsx", "pdf"]


def test_document_request_accepts_a_single_format() -> None:
    request = TaxInvoiceDocumentGenerateRequest(formats=["pdf"])

    assert request.formats == ["pdf"]


def test_document_request_deduplicates_formats() -> None:
    request = TaxInvoiceDocumentGenerateRequest(formats=["xlsx", "xlsx"])

    assert request.formats == ["xlsx"]


def test_document_request_requires_signature_id_when_signature_included() -> None:
    with pytest.raises(ValidationError, match="signatureId"):
        TaxInvoiceDocumentGenerateRequest(includeSignature=True)
