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


def test_document_request_allows_none_signature_id() -> None:
    request = TaxInvoiceDocumentGenerateRequest(includeSignature=True)
    assert request.include_signature is True
    assert request.signature_id is None
