from datetime import date
from decimal import Decimal
from io import BytesIO

from openpyxl import Workbook

from app.modules.tax_invoice.recognition import (
    combine_invoice_and_customs,
    lookup_fx_rate,
    parse_bot_fx_workbook,
    parse_invoice_workbook,
    parse_sample_workbook,
)


def _invoice_workbook() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "CI INVOICE"
    sheet["A1"] = "DATE：2026-06-05"
    sheet["A2"] = "INV.NO.：ZWT-TEST-001"
    sheet["A3"] = "INCOTERMS：FCA"
    sheet["A4"] = "PAYMENT TERMS：OA 30 DAYS"
    sheet["A5"] = "PO NO.：PO-001"
    sheet["A6"] = "BUYER："
    sheet["B6"] = "TEST CUSTOMER"
    sheet["B7"] = "BANGKOK"
    headers = [
        "ITEM NO.",
        "PRODUCT NAME",
        "PRODUCT CODE",
        "H.S. CODE",
        "QUANTITY",
        "UNIT",
        "UNIT PRICE",
        "AMOUNT USD",
    ]
    for column, header in enumerate(headers, start=1):
        sheet.cell(row=10, column=column, value=header)
    values = [1, "ROUTER", "R-1", "85176243", 10, "PIECES", 30, 300]
    for column, value in enumerate(values, start=1):
        sheet.cell(row=11, column=column, value=value)
    sheet["A12"] = "TOTAL"
    sheet["E12"] = 10
    sheet["H12"] = 300
    output = BytesIO()
    workbook.save(output)
    workbook.close()
    return output.getvalue()


def _bot_workbook() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet["C6"] = "05 JUN 2026"
    sheet["D6"] = "08 JUN 2026"
    sheet["B7"] = "REFERENCE RATE USD"
    sheet["C10"] = 32.1234
    sheet["D10"] = 32.2222
    output = BytesIO()
    workbook.save(output)
    workbook.close()
    return output.getvalue()


def test_invoice_parser_preserves_existing_fields_and_items() -> None:
    parsed = parse_invoice_workbook(_invoice_workbook(), "invoice.xlsx")

    assert parsed["ci_no"] == "ZWT-TEST-001"
    assert parsed["ci_date"] == date(2026, 6, 5)
    assert parsed["customer_name"] == "TEST CUSTOMER"
    assert parsed["quantity_total"] == Decimal("10")
    assert parsed["items"][0]["hs_code"] == "85176243"


def test_bot_parser_and_weekend_lookback() -> None:
    rates = parse_bot_fx_workbook(_bot_workbook(), "bot.xlsx")

    rate, matched_date = lookup_fx_rate(rates, date(2026, 6, 7))

    assert rate == Decimal("32.1234")
    assert matched_date == date(2026, 6, 5)


def test_combination_separates_invoice_and_matched_exchange_dates() -> None:
    invoice = parse_invoice_workbook(_invoice_workbook(), "invoice.xlsx")
    invoice["fob_amount_usd"] = Decimal("309.00")
    customs = {
        "cdn": "A001234567890",
        "submission_date": date(2026, 6, 7),
        "customs_fob_usd_total": Decimal("309.00"),
        "submission_date_low_confidence": False,
    }
    combined = combine_invoice_and_customs(
        invoice,
        customs,
        {date(2026, 6, 5): Decimal("32.1234")},
    )

    assert combined["invoice_date"] == date(2026, 6, 7)
    assert combined["exchange_target_date"] == date(2026, 6, 7)
    assert combined["exchange_rate_date"] == date(2026, 6, 5)
    assert combined["fob_revenue_usd_total"] == Decimal("309.00")
    assert combined["fob_verification_failed"] is False


def test_sample_import_marks_legacy_fx_date_fallback_for_review() -> None:
    workbook = Workbook()
    sheet = workbook.active
    headers = [
        "C/I No.",
        "CDN",
        "Customer Name",
        "Customer Address",
        "Product Name or Service",
        "Product Code",
        "Unit",
        "Quantity",
        "FX Date",
        "FX Rate",
        "FOB Rev USD",
        "FOB Rev THB",
    ]
    sheet.append(headers)
    sheet.append(
        [
            "ZWT-TEST-001",
            "A001234567890",
            "TEST CUSTOMER",
            "BANGKOK",
            "ROUTER",
            "R-1",
            "PIECES",
            10,
            "2026-06-07",
            32.1234,
            309,
            9926.13,
        ]
    )
    output = BytesIO()
    workbook.save(output)
    workbook.close()

    imported = parse_sample_workbook(output.getvalue(), "sample.xlsx")

    assert imported[0]["invoice_date"] == date(2026, 6, 7)
    assert imported[0]["submission_date_low_confidence"] is True
    assert imported[0]["submission_date_source"] == "legacy_fx_date_fallback"
