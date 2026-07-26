from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.tax_invoice.models import TaxInvoice, TaxInvoiceIssueCounter
from app.modules.tax_invoice.numbering import build_tax_invoice_number


async def assign_tax_invoice_number(
    session: AsyncSession,
    invoice: TaxInvoice,
) -> TaxInvoice:
    if invoice.document_no:
        return invoice
    if invoice.invoice_date is None:
        raise ValueError("invoice date is required before numbering")
    if invoice.status not in {"ready", "needs_review", "draft"}:
        raise ValueError("invoice cannot be numbered in its current status")

    counter_query = (
        select(TaxInvoiceIssueCounter)
        .where(TaxInvoiceIssueCounter.invoice_date == invoice.invoice_date)
        .with_for_update()
    )
    counter = await session.scalar(counter_query)
    if counter is None:
        await session.execute(
            insert(TaxInvoiceIssueCounter)
            .values(invoice_date=invoice.invoice_date, next_sequence=1)
            .on_conflict_do_nothing(
                constraint="uq_tax_invoice_issue_counter_date",
            )
        )
        counter = await session.scalar(counter_query)
        if counter is None:
            raise RuntimeError("failed to create or lock TAX INV issue counter")

    number = build_tax_invoice_number(invoice.invoice_date, counter.next_sequence)
    invoice.document_no = number.document_no
    invoice.status = "approved"
    counter.next_sequence += 1
    await session.flush()
    return invoice
