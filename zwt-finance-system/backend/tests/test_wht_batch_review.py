"""分步开票的核对口径 —— 业务规则锁定测试。

核对页（batch-preview）决定用户看到什么、要动手改什么，所以每一条判定都值得钉住：
判错一次，人就会照着错误的提示去改数据，最后开出错票。

这里只测纯函数（app.modules.wht.batch_review）。落库那半段要数据库，本套测试不连库，
其服务端复校由 test_wht_batch_import / 既有 rate_override 那几条覆盖同一份口径函数。
"""

from decimal import Decimal

from app.modules.wht.batch_review import PayeeSnapshot, review_row, withheld_amount

# ค่าบริการ（服务费）PND53 法定 3%；ค่าขนส่ง（运输费）PND53 法定 1%。
SERVICE = "ค่าบริการ"
TRANSPORT = "ค่าขนส่ง"


def sheet_row(**overrides) -> dict:
    row = {
        "row_number": 2,
        "payee_tax_id": "0105540057561",
        "income_type": SERVICE,
        "payment_date": "2026-06-05",
        "total_amount": Decimal("3000"),
        "period": "2026-06",
        "issuance_type": "normal",
        "supplement_run": 0,
        "wht_rate": None,
        "rate_reason": None,
    }
    return {**row, **overrides}


def known_payee(**overrides) -> PayeeSnapshot:
    return PayeeSnapshot(
        payee_id="payee-1",
        tax_id="0105540057561",
        name_th="บริษัท ทดสอบ จำกัด",
        name_en="Test Co., Ltd.",
        address_th="99/1 ถนนสุขุมวิท กรุงเทพมหานคร 10110",
        wht_type="PND53",
        **overrides,
    )


def test_known_payee_and_catalogue_rate_is_ready() -> None:
    reviewed = review_row(sheet_row(), known_payee())

    assert reviewed.status == "ready"
    assert reviewed.wht_rate == Decimal("0.03")
    assert reviewed.statutory_rate == Decimal("0.03")
    assert reviewed.wht_amount == Decimal("90.00")
    assert reviewed.errors == []


def test_unknown_payee_is_a_todo_not_an_error() -> None:
    """这是整个改动的核心：查不到收款方不再整表退回，而是标成待补录。"""
    reviewed = review_row(sheet_row(), None)

    assert reviewed.status == "payee_missing"
    assert reviewed.payee.payee_id is None
    assert reviewed.payee.tax_id == "0105540057561"
    # 不知道走 PND3 还是 PND53 就带不出法定税率，此时**不能猜**：
    # 猜错会让人在核对页看到一个像模像样却是错的税率，反而不会去改。
    assert reviewed.statutory_rate is None
    assert reviewed.errors == []


def test_unknown_payee_keeps_a_rate_written_in_the_sheet() -> None:
    # 表里明确填了税率就与收款方无关，补完档案不该让人再敲一遍。
    reviewed = review_row(sheet_row(wht_rate=Decimal("0.05")), None)

    assert reviewed.status == "payee_missing"
    assert reviewed.wht_rate == Decimal("0.05")
    assert reviewed.wht_amount == Decimal("150.00")


def test_deactivated_payee_says_so_instead_of_looking_missing() -> None:
    """停用 ≠ 不存在。说成"库里没有"会引导人再建一条重号的档案。"""
    reviewed = review_row(sheet_row(), known_payee(is_active=False))

    assert reviewed.status == "needs_input"
    assert "已停用" in reviewed.errors[0]


def test_income_type_outside_the_catalogue_asks_for_a_rate() -> None:
    reviewed = review_row(sheet_row(income_type="ค่าอะไรก็ไม่รู้"), known_payee())

    assert reviewed.status == "needs_input"
    assert reviewed.wht_rate is None
    assert "请直接填写税率" in reviewed.errors[0]


def test_free_text_income_type_with_an_explicit_rate_is_ready() -> None:
    # 目录外的类型查不到法定值，也就无从判定偏离，填了税率就该放行。
    reviewed = review_row(
        sheet_row(income_type="ค่าอะไรก็ไม่รู้", wht_rate=Decimal("0.02")),
        known_payee(),
    )

    assert reviewed.status == "ready"
    assert reviewed.rate_deviates is False


def test_rate_deviating_from_the_catalogue_requires_a_reason() -> None:
    reviewed = review_row(
        sheet_row(income_type=TRANSPORT, wht_rate=Decimal("0.05")),
        known_payee(),
    )

    assert reviewed.status == "needs_input"
    assert reviewed.rate_deviates is True
    # 两个税率都要出现在提示里，否则人不知道法定值是多少、该不该改回去。
    assert "5.00%" in reviewed.errors[0]
    assert "1.00%" in reviewed.errors[0]


def test_a_supplied_reason_clears_the_deviation() -> None:
    reviewed = review_row(
        sheet_row(
            income_type=TRANSPORT,
            wht_rate=Decimal("0.05"),
            rate_reason="合同约定 5%，见 2026-06 补充协议",
        ),
        known_payee(),
    )

    assert reviewed.status == "ready"
    assert reviewed.rate_deviates is True


def test_blank_reason_does_not_count() -> None:
    reviewed = review_row(
        sheet_row(income_type=TRANSPORT, wht_rate=Decimal("0.05"), rate_reason="   "),
        known_payee(),
    )

    assert reviewed.status == "needs_input"
    assert reviewed.rate_reason is None


def test_withheld_amount_rounds_half_up_like_the_service_does() -> None:
    """核对页显示的代扣金额必须与落库值一分不差，否则核对等于白核。"""
    # 1234.5 × 3% = 37.035 —— 银行家舍入会得到 37.03，业务口径要 37.04。
    assert withheld_amount(Decimal("1234.5"), Decimal("0.03")) == Decimal("37.04")
    assert withheld_amount(Decimal("3000"), None) is None
