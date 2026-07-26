from datetime import date

import pytest

from app.modules.tax_invoice.numbering import build_tax_invoice_number


def test_number_uses_invoice_date_and_daily_sequence() -> None:
    number = build_tax_invoice_number(date(2026, 6, 9), 3)

    assert number.document_no == "ZWT-IV20260609-03"


def test_number_rejects_non_positive_sequence() -> None:
    with pytest.raises(ValueError, match="positive"):
        build_tax_invoice_number(date(2026, 6, 9), 0)
