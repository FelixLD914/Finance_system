from decimal import Decimal

import pytest

from app.modules.salary_advance.bahttext import bahttext
from app.modules.salary_advance.validation import (
    map_headers,
    safe_excel_text,
    validate_and_normalize_record,
)


@pytest.mark.parametrize(
    ("amount", "expected"),
    [
        ("0", "ศูนย์บาทถ้วน"),
        ("1", "หนึ่งบาทถ้วน"),
        ("11", "สิบเอ็ดบาทถ้วน"),
        ("21.25", "ยี่สิบเอ็ดบาทยี่สิบห้าสตางค์"),
        ("1000001", "หนึ่งล้านเอ็ดบาทถ้วน"),
    ],
)
def test_bahttext_matches_approved_source_rules(
    amount: str,
    expected: str,
) -> None:
    assert bahttext(Decimal(amount)) == expected


def test_header_aliases_accept_approved_bilingual_template() -> None:
    mapping = map_headers(
        (
            "期间",
            "Emp.ID\n工号",
            "EN Name\n英文名字",
            "Dept\n部门",
            "Position\n职位",
            "预支金额",
        )
    )

    assert mapping == {
        "period": 0,
        "emp_id": 1,
        "en_name": 2,
        "department": 3,
        "position": 4,
        "advance_amount": 5,
    }


def test_valid_record_is_normalized_without_real_signature_files() -> None:
    status, errors, warnings, normalized = validate_and_normalize_record(
        {
            "period": "202607",
            "emp_id": "E001",
            "first_name": "SOMCHAI",
            "surname": "TEST",
            "department": "Finance",
            "position": "Accountant",
            "start_date": "2024-01-15",
            "request_date": "2026-07-20",
            "advance_amount": "12,500.50",
            "monthly_deduction": "2,500.10",
            "approval_status": "Approve",
            "applicant_signature_mode": "Handwritten",
            "finance_signature_code": "FIN_TEST",
            "md_signature_code": "MD_TEST",
        },
        batch_period="202607",
        active_signature_codes={"FIN_TEST", "MD_TEST"},
    )

    assert status == "warning"
    assert errors == []
    assert warnings
    assert normalized["advance_amount"] == "12500.50"
    assert normalized["monthly_deduction"] == "2500.10"
    assert normalized["applicant_display_name"] == "SOMCHAI TEST"
    assert normalized["applicant_signature_mode"] == "Handwritten"


def test_invalid_signature_mode_and_unbound_codes_are_blocking() -> None:
    status, errors, _, normalized = validate_and_normalize_record(
        {
            "period": "202607",
            "emp_id": "E002",
            "first_name": "A",
            "surname": "B",
            "department": "Finance",
            "position": "Officer",
            "start_date": "2024-01-01",
            "request_date": "2026-07-01",
            "advance_amount": "1000",
            "monthly_deduction": "100",
            "applicant_signature_mode": "Digital",
            "finance_signature_code": "FIN_MISSING",
            "md_signature_code": "MD_MISSING",
        },
        batch_period="202607",
        active_signature_codes=set(),
    )

    assert status == "invalid"
    assert {issue["code"] for issue in errors} >= {
        "INVALID_MODE",
        "SIGNATURE_NOT_FOUND",
    }
    assert normalized["applicant_signature_mode"] == "Handwritten"


def test_md_signer_is_derived_from_display_name_not_guessed() -> None:
    """签名代码可从签字人姓名确定性映射；无法确定时必须报错而不是猜。"""
    base = {
        "period": "202602",
        "emp_id": "E003",
        "first_name": "A",
        "surname": "B",
        "department": "Finance",
        "position": "Officer",
        "start_date": "2024-01-01",
        "request_date": "2026-02-01",
        "advance_amount": "1000",
        "monthly_deduction": "100",
        "approval_status": "Approve",
    }

    _, _, _, normalized = validate_and_normalize_record(
        {**base, "md_display_name": "龚尧文", "finance_display_name": "邢兰慧"},
        batch_period="202602",
        active_signature_codes={"FIN_XING_LANHUI", "MD_GONG_YAOWEN"},
    )
    assert normalized["md_signature_code"] == "MD_GONG_YAOWEN"
    assert normalized["finance_signature_code"] == "FIN_XING_LANHUI"

    # 总经理签字人缺失/不认识：不允许按期间月份之类的旁证猜签名人。
    status, errors, _, _ = validate_and_normalize_record(
        base,
        batch_period="202602",
        active_signature_codes={"FIN_XING_LANHUI"},
    )
    assert status == "invalid"
    assert any(
        issue["field"] == "md_signature_code" and issue["code"] == "SIGNER_UNKNOWN"
        for issue in errors
    )


def test_signature_codes_resolve_against_shared_library_names() -> None:
    """active_signature_codes 现在就是共享签名库里 active 资产的名称集合。"""
    status, errors, _, _ = validate_and_normalize_record(
        {
            "period": "202607",
            "emp_id": "E004",
            "first_name": "A",
            "surname": "B",
            "department": "Finance",
            "position": "Officer",
            "start_date": "2024-01-01",
            "request_date": "2026-07-01",
            "advance_amount": "1000",
            "monthly_deduction": "100",
            "approval_status": "Approve",
            "finance_signature_code": "fin_xing_lanhui",
            "md_signature_code": "MD_NOT_IN_LIBRARY",
        },
        batch_period="202607",
        active_signature_codes={"FIN_XING_LANHUI"},
    )
    assert status == "invalid"
    codes = {(issue["field"], issue["code"]) for issue in errors}
    # 小写输入被规范成大写后命中签名库；不在库里的必须拦下。
    assert ("finance_signature_code", "SIGNATURE_NOT_FOUND") not in codes
    assert ("md_signature_code", "SIGNATURE_NOT_FOUND") in codes


def test_excel_formula_prefix_is_escaped() -> None:
    assert safe_excel_text("=HYPERLINK(\"https://example.invalid\")").startswith("'=")
