r"""把三份"填了样例数据的真实出票 PDF"渲染成签名预览底图。

    cd zwt-finance-system\backend
    .\.venv\Scripts\python.exe ..\scripts\build_signature_preview_backgrounds.py

**底图 = 后端真出的那一页，只是没盖章。** 预览里除签名之外的一切，都是出票时
的那一套字体、断词、列宽、对齐，不再有第二份"看起来差不多"的实现。

为什么改成这样：早先渲染的是**空白底版**，样例数据由前端在 HTML 里按百分比手工
摆。那些百分比与后端的 TextAnchor 毫无关系，于是必然对不上——2026-08-05 用户实拍
的三张图里，TAX INV 的品名被裁掉半个字（`EXPORT` 只剩 `XPORT`）、报关单号压在泰文
标签上、工资预支的金额盖住表单印刷字。**手工摆的样例文字这条路已经删掉，不要再加
回来**：它每次都要重新对一遍，而且对错了没有任何东西会报警。

彩色：TAX INV 与工资预支的底版左上角是公司 logo，出票就是彩色的，预览必须同色。
（早先为压体积渲染成灰度 + 16 色调色板，logo 会变成灰块。）

存 lossless WebP：同一张图比 PNG 小三到四成，仓库里已经有 login-bg.webp 的先例。
三张合计约 250KB，比灰度空白底版的 68KB 大，这是彩色 + 带数据必然的代价。

渲染尺寸固定 150 DPI（A4 → 1241x1754）；预览按百分比定位，换尺寸不影响签名落点，
但会让 git diff 变成整张图重写。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from datetime import date
from decimal import Decimal
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = REPO_ROOT / "backend"
TEMPLATE_DIR = BACKEND_ROOT / "app" / "assets" / "templates"
FONT_DIR = BACKEND_ROOT / "app" / "assets" / "fonts"
PUBLIC_DIR = REPO_ROOT / "frontend" / "public"
MANIFEST = PUBLIC_DIR / "signature-preview-backgrounds.json"

sys.path.insert(0, str(BACKEND_ROOT))

RENDER_DPI = 150

# 底图的内容不只取决于底版，还取决于**把数据画上去的那些坐标**。底版没变但坐标
# 改了，底图照样过期——所以这些文件也一起记进清单，由
# tests/test_signature_preview_alignment.py 一并核。
LAYOUT_SOURCES: dict[str, tuple[str, ...]] = {
    "wht-template-bg.webp": ("app/modules/wht/document_generator.py",),
    "tax-inv-template-bg.webp": (
        "app/modules/tax_invoice/document_generator.py",
        "app/modules/tax_invoice/pdf_layout.py",
    ),
    "salary-advance-template-bg.webp": (
        "app/modules/salary_advance/document_generator.py",
        "app/modules/salary_advance/pdf_layout.py",
    ),
}

PLATES: dict[str, str] = {
    "wht-template-bg.webp": "WHT-Template.pdf",
    "tax-inv-template-bg.webp": "TAX-INV-Template.pdf",
    "salary-advance-template-bg.webp": "Salary-Advance-Template.pdf",
}


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def recipe_sha256(png_name: str) -> str:
    """把这张底图依赖的所有布局源文件揉成一个 sha，改了任意一个都会变。"""
    digest = hashlib.sha256()
    for relative in LAYOUT_SOURCES[png_name]:
        digest.update((BACKEND_ROOT / relative).read_bytes())
    return digest.hexdigest()


# ── 样例数据 ────────────────────────────────────────────────────────────────
# 明显是样例、但字段长度贴近真实（泰文公司名、13 位税号、六位金额），否则预览
# 演不出真实的断词与列宽表现——而那正是这次要修的东西。


def _wht_pdf(output: Path) -> None:
    from app.modules.wht.document_generator import export_pdf_from_template
    from app.modules.wht.models import WhtTask

    task = WhtTask(
        task_no="ZWT202607001",
        book_no="202607",
        period="2026-07",
        issuance_type="normal",
        supplement_run=0,
        status="approved",
        company_name="บริษัท ตัวอย่าง โลจิสติกส์ จำกัด",
        payee_address="กรุงเทพมหานคร 10250",
        tax_id="0105540057561",
        wht_type="PND53",
        branch_type="head_office",
        branch_number=None,
        income_type="ค่าบริการ (Services)",
        payment_date=date(2026, 7, 3),
        wht_rate=Decimal("0.03"),
        total_amount=Decimal("150000.00"),
        wht_amount=Decimal("4500.00"),
    )
    export_pdf_from_template(
        TEMPLATE_DIR / "WHT-Template.pdf",
        output,
        task,
        FONT_DIR / "Sarabun-Regular.ttf",
        None,  # 不盖章：签名由预览自己叠，才能跟着滑块实时动
    )


def _tax_inv_pdf(output: Path) -> None:
    from app.modules.tax_invoice.document_generator import export_pdf_from_template
    from app.modules.tax_invoice.models import TaxInvoice, TaxInvoiceItem

    invoice = TaxInvoice(
        document_no="ZWT-IV20260715-01",
        status="approved",
        ci_no="ZWT-NSB26071501",
        cdn="A019-06907-00381",
        invoice_date=date(2026, 7, 15),
        exchange_target_date=date(2026, 7, 15),
        exchange_rate_date=date(2026, 7, 14),
        currency="USD",
        exchange_rate=Decimal("32.4567"),
        customer_name="SIAM LOGISTICS GROUP CO., LTD.",
        customer_address="เขตบางนา กรุงเทพมหานคร 10260",
        tax_id="0105558004821",
        po_no="PO-2026-0715",
        payment_term="30 DAYS",
        fob_revenue_usd_total=Decimal("14789.00"),
        fob_revenue_thb_total=Decimal("480000.00"),
        created_by_name="Preview",
        updated_by_name="Preview",
    )
    items = [
        TaxInvoiceItem(
            line_number=1,
            product_name="EXPORT FREIGHT SERVICES",
            product_code="P-0001",
            unit="LOT",
            quantity=Decimal("1"),
            fob_unit_price_usd=Decimal("9860.0000"),
            fob_revenue_usd=Decimal("9860.00"),
            fob_revenue_thb=Decimal("320000.00"),
        ),
        TaxInvoiceItem(
            line_number=2,
            product_name="CUSTOMS CLEARANCE HANDLING",
            product_code="P-0002",
            unit="LOT",
            quantity=Decimal("2"),
            fob_unit_price_usd=Decimal("2464.5000"),
            fob_revenue_usd=Decimal("4929.00"),
            fob_revenue_thb=Decimal("160000.00"),
        ),
    ]
    export_pdf_from_template(
        TEMPLATE_DIR / "TAX-INV-Template.pdf",
        output,
        invoice,
        items,
        FONT_DIR / "Sarabun-Regular.ttf",
        signature_source_path=None,
    )


def _salary_advance_pdf(output: Path, workspace: Path) -> None:
    from PIL import Image

    from app.modules.salary_advance.document_generator import (
        GenerationSnapshot,
        export_pdf_from_template,
    )

    # 两个签名位都要给一张能打开的图（_validate_signature 会拦不存在的文件）。
    # 用 1x1 全透明：画上去等于什么都没画，底图因此保持"未盖章"。
    blank = workspace / "blank-signature.png"
    Image.new("RGBA", (1, 1), (255, 255, 255, 0)).save(blank)

    snapshot = GenerationSnapshot(
        normalized_data={
            "period": "202607",
            "emp_id": "EMP08821",
            "en_name": "SOMCHAI JAIDEE",
            "first_name": "SOMCHAI",
            "surname": "JAIDEE",
            "chinese_name": "",
            "applicant_display_name": "SOMCHAI JAIDEE",
            "department": "Logistics Operations",
            "position": "Warehouse Supervisor",
            "start_date": "2024-01-15",
            "reason": "Family medical expenses",
            "advance_amount": "25000.00",
            "advance_amount_words_th": "สองหมื่นห้าพันบาทถ้วน",
            "monthly_deduction": "5000.00",
            "monthly_deduction_words_th": "ห้าพันบาทถ้วน",
            "request_date": "2026-07-01",
            "finance_comment": "Verified",
            "finance_display_name": "XING LANHUI",
            "finance_date": "2026-07-02",
            "approval_status": "Approve",
            "md_display_name": "GONG YAOWEN",
            "md_date": "2026-07-03",
            "applicant_signature_mode": "Handwritten",
            "output_filename": "signature-preview-sample",
        },
        finance_signature_path=blank,
        md_signature_path=blank,
        finance_signature_version={},
        md_signature_version={},
    )
    export_pdf_from_template(
        TEMPLATE_DIR / "Salary-Advance-Template.pdf",
        output,
        snapshot,
        FONT_DIR / "THSarabunPSK.ttf",
        xlsx_template_path=TEMPLATE_DIR / "Salary-Advance-Template.xlsx",
    )


def build_sample_pdf(png_name: str, output: Path, workspace: Path) -> None:
    if png_name == "wht-template-bg.webp":
        _wht_pdf(output)
    elif png_name == "tax-inv-template-bg.webp":
        _tax_inv_pdf(output)
    else:
        _salary_advance_pdf(output, workspace)


def render(pdf_path: Path, image_path: Path) -> tuple[int, int]:
    import pypdfium2

    document = pypdfium2.PdfDocument(str(pdf_path))
    try:
        # 彩色：TAX INV 与工资预支的 logo 是公司标识，出票是彩的，预览就得是彩的。
        bitmap = document[0].render(scale=RENDER_DPI / 72)
        image = bitmap.to_pil().convert("RGB")
    finally:
        document.close()
    image.save(image_path, format="WEBP", lossless=True, method=6)
    return image.size


def build(*, check_only: bool = False) -> int:
    previous: dict[str, dict[str, str]] = {}
    if MANIFEST.is_file():
        previous = json.loads(MANIFEST.read_text(encoding="utf-8")).get("backgrounds", {})

    manifest: dict[str, dict[str, str]] = {}
    stale: list[str] = []
    with tempfile.TemporaryDirectory() as raw_workspace:
        workspace = Path(raw_workspace)
        for image_name, plate_name in PLATES.items():
            plate = TEMPLATE_DIR / plate_name
            if not plate.is_file():
                raise SystemExit(f"底版不存在：{plate}")
            entry = {
                "source": plate_name,
                "sourceSha256": sha256_of(plate),
                "layoutSha256": recipe_sha256(image_name),
            }
            recorded = previous.get(image_name, {})
            outdated = (
                recorded.get("sourceSha256") != entry["sourceSha256"]
                or recorded.get("layoutSha256") != entry["layoutSha256"]
                or not (PUBLIC_DIR / image_name).is_file()
            )
            if outdated:
                stale.append(image_name)
                if not check_only:
                    sample = workspace / f"{image_name}.pdf"
                    build_sample_pdf(image_name, sample, workspace)
                    width, height = render(sample, PUBLIC_DIR / image_name)
                    size_kb = (PUBLIC_DIR / image_name).stat().st_size / 1024
                    print(
                        f"rendered {image_name}  {width}x{height}  "
                        f"{size_kb:.0f}KB  <- {plate_name} + 样例数据"
                    )
            manifest[image_name] = entry

    if check_only:
        if stale:
            print("以下底图与当前底版/坐标不一致：" + "、".join(stale))
            return 1
        print("所有签名预览底图都是最新的。")
        return 0

    MANIFEST.write_text(
        json.dumps({"renderDpi": RENDER_DPI, "backgrounds": manifest},
                   ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"manifest={MANIFEST}")
    if not stale:
        print("（底版与坐标都没变，底图无需重渲染）")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="只检查底图是否与底版/坐标一致，不重新渲染；不一致时以非 0 退出。",
    )
    raise SystemExit(build(check_only=parser.parse_args().check))


if __name__ == "__main__":
    main()
