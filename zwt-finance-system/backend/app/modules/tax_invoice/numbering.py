from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class TaxInvoiceNumber:
    document_no: str
    invoice_date: date
    sequence: int


def build_tax_invoice_number(invoice_date: date, sequence: int) -> TaxInvoiceNumber:
    if sequence < 1:
        raise ValueError("sequence must be positive")
    return TaxInvoiceNumber(
        document_no=f"ZWT-IV{invoice_date:%Y%m%d}-{sequence:02d}",
        invoice_date=invoice_date,
        sequence=sequence,
    )
