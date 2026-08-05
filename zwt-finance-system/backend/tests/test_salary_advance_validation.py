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


BASE_ROW = {
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
    "finance_display_name": "邢兰慧",
    "md_display_name": "龚尧文",
}


def test_valid_record_is_normalized_without_real_signature_files() -> None:
    status, errors, warnings, normalized = validate_and_normalize_record(
        dict(BASE_ROW),
        batch_period="202607",
    )

    assert status == "warning"
    assert errors == []
    assert warnings
    assert normalized["advance_amount"] == "12500.50"
    assert normalized["monthly_deduction"] == "2500.10"
    assert normalized["applicant_display_name"] == "SOMCHAI TEST"
    assert normalized["applicant_signature_mode"] == "Handwritten"


def test_invalid_signature_mode_is_blocking() -> None:
    status, errors, _, normalized = validate_and_normalize_record(
        {**BASE_ROW, "applicant_signature_mode": "Digital"},
        batch_period="202607",
    )

    assert status == "invalid"
    assert {issue["code"] for issue in errors} >= {"INVALID_MODE"}
    assert normalized["applicant_signature_mode"] == "Handwritten"


def test_signature_columns_never_block_the_import() -> None:
    """签名区四列全部可留空——导入侧完全不管签名。

    单据上印的签字人姓名取自签名资产的 signer_name（见
    SalaryAdvanceDocumentService._snapshot），不取导入行；盖哪张章在开具时选。
    所以这四列缺任何一个都不该把整行判成 invalid——那样 create_job 会直接排除它
    （只取 validation_status != "invalid"），这一行连被选中开具的机会都没有。
    """
    status, errors, _, normalized = validate_and_normalize_record(
        {
            **BASE_ROW,
            "finance_display_name": "",
            "md_display_name": "",
            "finance_signature_code": "",
            "md_signature_code": "",
        },
        batch_period="202607",
    )

    assert status != "invalid"
    assert errors == []
    for field in (
        "finance_display_name",
        "md_display_name",
        "finance_signature_code",
        "md_signature_code",
    ):
        assert normalized[field] == ""


def test_signature_codes_are_optional_and_never_inferred() -> None:
    """签名代码不再从签字人姓名推断，也不再校验是否存在于签名库。

    2026-08-05 口径（参照 WHT）：导入只校验单据要印的信息，盖哪张章在开具时选。
    原先有一整套「龚尧文→MD_GONG_YAOWEN」推断 + 签名库存在性校验 + 两级硬阻断，
    把一件开具时才定的事挡在了导入口上——整行判 invalid 之后 create_job 直接
    排除它，那一行连被选中开具的机会都没有。
    """
    # 完全不填代码：照样能过，不推断、不报错。
    status, errors, _, normalized = validate_and_normalize_record(
        dict(BASE_ROW),
        batch_period="202607",
    )
    assert status != "invalid"
    assert errors == []
    assert normalized["finance_signature_code"] == ""
    assert normalized["md_signature_code"] == ""

    # 填了库里没有的代码：也不挡导入（签名库随时可补，开具时也能改选）。
    status, errors, _, normalized = validate_and_normalize_record(
        {
            **BASE_ROW,
            "finance_signature_code": "fin_xing_lanhui",
            "md_signature_code": "MD_NOT_IN_LIBRARY",
        },
        batch_period="202607",
    )
    assert status != "invalid"
    assert errors == []
    # 原样收下，只做大小写规范化——开具时按它去签名库找。
    assert normalized["finance_signature_code"] == "FIN_XING_LANHUI"
    assert normalized["md_signature_code"] == "MD_NOT_IN_LIBRARY"


def test_signer_names_are_kept_verbatim_as_source_data() -> None:
    """姓名照抄留档，不做任何"标准签字人"替换。

    留的是导入原始数据（可追溯），**不参与出单**——出单时
    `_snapshot` 会用签名资产上的 signer_name 覆盖这两列。
    """
    _, _, _, normalized = validate_and_normalize_record(
        {**BASE_ROW, "md_display_name": "朱发坚", "finance_display_name": "张三"},
        batch_period="202607",
    )
    assert normalized["md_display_name"] == "朱发坚"
    assert normalized["finance_display_name"] == "张三"


def test_excel_formula_prefix_is_escaped() -> None:
    assert safe_excel_text("=HYPERLINK(\"https://example.invalid\")").startswith("'=")
