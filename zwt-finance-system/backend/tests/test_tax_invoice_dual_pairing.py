"""识别建单的配对：按内容（C/I No.）配，不按文件名配。

为什么值得专门一组测试：Web 版原本按"同名文件自动成一组"配对，实测在真实归档上
100% 配错——同名的那份 PDF 全都是发票自己的打印件，不是报关单。这里把那条错误
规则会撞上的三种形态钉住，防止以后有人"顺手"把文件名配对加回来。
"""

from __future__ import annotations

import pytest

from app.modules.tax_invoice.customs_declaration import (
    looks_like_export_declaration,
    parse_thai_date,
    thai_skeleton,
)
from app.modules.tax_invoice.dual_pairing import (
    IdentifiedFile,
    classify_file,
    pair_identified_files,
    pairing_key,
)

# 真实文件名（取自 Sample_reg 归档），刻意保留那些容易踩坑的形态。
INVOICE_NAME = "3.ZWT：20260123-NOKIA-IV&PL(ZWT-NSB26012304)-120台 WLS604-A-B FCA USD7,077.60.xlsx"
INVOICE_PRINTOUT = INVOICE_NAME.replace(".xlsx", ".pdf")
DECLARATION_NAME = "QECL603151144.pdf"


def invoice(name: str = INVOICE_NAME, ci_no: str = "ZWT-NSB26012304") -> IdentifiedFile:
    return IdentifiedFile(
        file_name=name,
        kind="invoice",
        key=pairing_key(ci_no),
        data={"ci_no": ci_no, "items": [{}]},
    )


def _parse_flat_for_test(text: str):
    """把一段纯文本当作报关单文本层喂给解析器。

    出口报关单的解析全部基于文本层，所以这里绕过 pdfplumber 直接注入页文本——
    为了测一条判据去造真 PDF 不值得，且真样本已有独立的实测脚本覆盖。
    """
    import app.modules.tax_invoice.customs_declaration as module

    original = module.extract_pages
    module.extract_pages = lambda _content: ([text], {})
    try:
        return module.parse_export_declaration(b"stub")
    finally:
        module.extract_pages = original


def declaration(
    name: str = DECLARATION_NAME,
    ci_no: str = "ZWT-NSB26012304",
    **data: object,
) -> IdentifiedFile:
    return IdentifiedFile(
        file_name=name,
        kind="customs",
        key=pairing_key(ci_no),
        data={"ci_no": ci_no, **data},
    )


def test_pairs_by_ci_no_even_when_file_names_share_nothing() -> None:
    """发票叫 `3.ZWT：…IV&PL(...).xlsx`，报关单叫 `QECL603151144.pdf`——真实归档里
    两者文件名毫无关系，只有内容里的 C/I No. 对得上。"""
    pairs, unpairable = pair_identified_files([invoice(), declaration()])
    assert not unpairable
    assert len(pairs) == 1
    assert pairs[0].status == "ready"
    assert pairs[0].invoice is not None and pairs[0].customs is not None
    assert pairs[0].customs.file_name == DECLARATION_NAME


def test_invoice_without_declaration_is_importable_not_blocked() -> None:
    """关单还没下来时这一组仍要能导（业务口径 2026-07-30），只是标成待补关单。"""
    pairs, _ = pair_identified_files([invoice()])
    assert [pair.status for pair in pairs] == ["invoice_only"]
    assert pairs[0].invoice is not None
    assert pairs[0].customs is None


def test_declaration_without_invoice_is_kept_and_flagged() -> None:
    """孤立关单不能静默消失——界面要显示它在等发票。"""
    pairs, _ = pair_identified_files([declaration()])
    assert [pair.status for pair in pairs] == ["customs_only"]


def test_draft_declaration_is_rejected_not_used_for_invoicing() -> None:
    """报关单号与提交日期都读不到 = 草稿件，不用于出口开票（业务口径 2026-07-30）。

    草稿件没有单号是因为它还没递交，不是识别失败——所以这是判据，不是缺陷。
    """
    from app.modules.tax_invoice.customs_declaration import CustomsDeclarationError

    draft = (
        "Printed Date/Time : 03/02/2026 17:22:59 ใบขนสินคา ขาออก กศก.101/1 "
        "บัญชีราคาสินค้า : ZWT-MT20260122001 : 22/01/2026 "
        "อัตราแลกเปลี่ยน 1 USD=30.9979 THB USD 1,501,527.41"
    )
    with pytest.raises(CustomsDeclarationError, match="草稿件"):
        _parse_flat_for_test(draft)


def test_real_declaration_missing_only_one_of_the_two_is_kept_for_review() -> None:
    """只缺一个（比如文本层坏了丢了提交日期）属于识别问题，收下来标 needs_review。

    不能当草稿退掉：真单子退掉了，人就没法在界面上对着图把日期补进来。
    """
    got = _parse_flat_for_test(
        "ใบขนสินค้าขาออก กศก 101/1 *A0231690118554* INV# ZWT-NSB26012304 :23/01/2026 "
        "อัตราแลกเปลี่ยน 1.00 USD = 31.062700 THB USD 7,289.93"
    )
    assert got.value("cdn") == "A0231690118554"
    assert got.value("submission_date") is None
    assert got.fields["submission_date"].review_required


def test_ready_pairs_sort_before_incomplete_ones() -> None:
    pairs, _ = pair_identified_files(
        [
            declaration(name="orphan.pdf", ci_no="ZWT-NSB26000001"),
            invoice(name="pending.xlsx", ci_no="ZWT-NSB26000002"),
            invoice(),
            declaration(),
        ]
    )
    assert [pair.status for pair in pairs] == [
        "ready",
        "invoice_only",
        "customs_only",
    ]


def test_same_declaration_uploaded_twice_is_safe_to_auto_pick() -> None:
    """报关单号相同 = 同一份关单重复上传/重打印，取一份即可，其余留痕。

    真实案例：`01期/3.NOKIA…` 目录下 `0409_1071805218.pdf` 与
    `A0091690101266.pdf` 的 CDN、提交日期完全相同，只是打印日期差了 10 天。
    """
    import datetime

    reprint = declaration(
        name="0409_1071805218.pdf",
        submission_date=datetime.date(2026, 1, 9),
        cdn="A0091690101266",
    )
    original = declaration(
        name="A0091690101266.pdf",
        submission_date=datetime.date(2026, 1, 9),
        cdn="A0091690101266",
    )
    pairs, _ = pair_identified_files([invoice(), reprint, original])
    assert len(pairs) == 1
    assert pairs[0].status == "ready"
    assert pairs[0].customs is not None
    assert len(pairs[0].superseded_customs) == 1
    assert not pairs[0].conflicts


def test_two_different_declarations_for_one_ci_no_go_to_a_human() -> None:
    """报关单号不同 = 与"一票对一单"冲突，不自动选。

    自动挑一份的风险不是"挑得不好"，是拿作废的那版开成了税票——金额看着都合理，
    事后极难发现。所以整组判 conflict，界面上不许导。
    """
    import datetime

    first = declaration(
        name="A0091690101266.pdf",
        submission_date=datetime.date(2026, 1, 9),
        cdn="A0091690101266",
    )
    amended = declaration(
        name="A0201690101886.pdf",
        submission_date=datetime.date(2026, 1, 20),
        cdn="A0201690101886",
    )
    pairs, _ = pair_identified_files([invoice(), first, amended])
    assert len(pairs) == 1
    assert pairs[0].status == "conflict"
    assert pairs[0].conflicts
    assert "A0091690101266" in pairs[0].conflicts[0]
    assert "A0201690101886" in pairs[0].conflicts[0]


def test_conflicts_sort_to_the_top() -> None:
    """要人工处理的排最前——排在二十组后面就等于没提示。"""
    import datetime

    pairs, _ = pair_identified_files(
        [
            invoice(name="ok.xlsx", ci_no="ZWT-NSB26000009"),
            declaration(name="ok.pdf", ci_no="ZWT-NSB26000009", cdn="A1"),
            invoice(),
            declaration(name="a.pdf", cdn="A2", submission_date=datetime.date(2026, 1, 1)),
            declaration(name="b.pdf", cdn="A3", submission_date=datetime.date(2026, 1, 2)),
        ]
    )
    assert [pair.status for pair in pairs] == ["conflict", "ready"]


def test_unreadable_and_keyless_files_are_reported_not_dropped() -> None:
    pairs, unpairable = pair_identified_files(
        [
            IdentifiedFile(file_name="broken.pdf", kind="customs", error="坏文件"),
            IdentifiedFile(file_name="no-ci.xlsx", kind="invoice", key=""),
        ]
    )
    assert pairs == []
    assert {item.file_name for item in unpairable} == {"broken.pdf", "no-ci.xlsx"}


def test_two_invoices_for_one_ci_no_are_not_silently_deduped() -> None:
    """同一张发票传了两份（改过的和原始的）。金额可能不一样，猜错就是开错票。"""
    pairs, unpairable = pair_identified_files(
        [invoice(), invoice(name="改后.xlsx")]
    )
    assert len(pairs) == 1
    assert pairs[0].invoice is not None
    assert [item.file_name for item in unpairable] == ["改后.xlsx"]


@pytest.mark.parametrize(
    ("file_name", "expected"),
    [
        ("a.xlsx", "invoice"),
        ("a.XLS", "invoice"),
        ("QECL603151144.pdf", "customs"),
        ("ใบขนเจินเวสเทิร์น04.PDF", "customs"),
        ("Export Clearance Instruction Form.docx", None),
    ],
)
def test_classify_file(file_name: str, expected: str | None) -> None:
    assert classify_file(file_name) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("ZWT-NSB26012304", "ZWT-NSB26012304"),
        # Excel 里票号常带个尾点，报关单上没有——不归一化就配不上。
        ("ZWT-NSB26012304.", "ZWT-NSB26012304"),
        (" zwt-nsb26012304 ", "ZWT-NSB26012304"),
        (None, ""),
    ],
)
def test_pairing_key_normalises_both_sides(raw: str | None, expected: str) -> None:
    assert pairing_key(raw) == expected


def test_invoice_printout_is_not_mistaken_for_a_declaration() -> None:
    """发票的 PDF 打印件里也印着同一个 C/I No.，但它不是报关单。

    没有这道判别，按内容配对时它会跟着撞进同一组，甚至在真关单缺席时被当成关单
    用——正是文件名配对时代那个"读出来 CDN 空、提交日期空却照样出票"的老毛病。
    """
    invoice_text = (
        "ZHENWESTERN TECHNOLOGIES (THAILAND) CO., LTD. COMMERCIAL INVOICE "
        "INV. NO.: ZWT-NSB26012304 FCA USD 7,077.60 WLS604-A-B"
    )
    assert not looks_like_export_declaration(invoice_text)

    declaration_text = "ใบขนสินค้าขาออก กศก 101/1 *A0231690118554* FOB USD 7,289.93"
    assert looks_like_export_declaration(declaration_text)


def test_thai_skeleton_survives_print_to_pdf_reordering() -> None:
    """D&M 那家的 print-to-PDF 把 'วันที่ยื่น' 打散成 'วนั ทยี น ื'。

    原样子串匹配必然落空，辅音骨架 ว-น-ท-ย-น 则稳定——提交日期识别就靠这个。
    """
    assert thai_skeleton("วันที่ยื่น") == thai_skeleton("วนั ทยี น ื")


@pytest.mark.parametrize(
    ("raw", "iso"),
    [
        # 佛历（报关单上的提交日期）
        ("23/01/2569", "2026-01-23"),
        ("7/01/2569", "2026-01-07"),
        # 公历（同一页上的打印日期）——不能被当成佛历再减 543
        ("26/01/2026", "2026-01-26"),
        ("2026-01-23", "2026-01-23"),
        ("", None),
        ("not a date", None),
    ],
)
def test_parse_thai_date_handles_mixed_calendars(raw: str, iso: str | None) -> None:
    parsed = parse_thai_date(raw)
    assert (parsed.isoformat() if parsed else None) == iso
