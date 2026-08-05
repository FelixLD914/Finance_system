r"""把三份 PDF 底版渲染成签名预览用的底图 PNG，并记下各自的源底版 sha256。

    cd zwt-finance-system\backend
    .\.venv\Scripts\python.exe ..\scripts\build_signature_preview_backgrounds.py

为什么要有清单文件：底图是"底版的一张照片"，底版一重制它就过期，但过期的底图
看上去完全正常——只是签名画在了错的位置上。2026-08-04 就这么出过一次：底版当天
重制了四轮，底图还停在凌晨那一版，于是维护页预览里的签名比实际出票低了 4.5mm。
把源底版的 sha 写进 signature-preview-backgrounds.json，
tests/test_signature_preview_alignment.py 就能把这种漂移变成一条红测试。

渲染尺寸固定 150 DPI（A4 → 1241x1754），与首版底图一致；预览是按百分比定位的，
换尺寸不会影响签名落点，但换了会让 git diff 变成整张图重写。
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
TEMPLATE_DIR = BACKEND_ROOT / "app" / "assets" / "templates"
PUBLIC_DIR = Path(__file__).resolve().parents[1] / "frontend" / "public"
MANIFEST = PUBLIC_DIR / "signature-preview-backgrounds.json"

RENDER_DPI = 150

# 底图名 -> 源底版。工资预支的两个角色共用同一张底图（同一页上下两个签名位）。
SOURCES: dict[str, str] = {
    "wht-template-bg.png": "WHT-Template.pdf",
    "tax-inv-template-bg.png": "TAX-INV-Template.pdf",
    "salary-advance-template-bg.png": "Salary-Advance-Template.pdf",
}


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def render(pdf_path: Path, png_path: Path) -> tuple[int, int]:
    import pypdfium2

    document = pypdfium2.PdfDocument(str(pdf_path))
    try:
        page = document[0]
        # 底版是线稿表单：灰度 + 关掉抗锯齿，输出接近二值，PNG 压缩率极高
        # （实测 WHT 由彩色 256 色的 167KB 降到 29KB），线条反而更锐利。
        # scale 是相对 72 DPI 的倍数。
        bitmap = page.render(
            scale=RENDER_DPI / 72,
            grayscale=True,
            no_smoothtext=True,
            no_smoothpath=True,
            no_smoothimage=True,
        )
        image = bitmap.to_pil().convert("L")
    finally:
        document.close()
    image.convert("P", palette=1, colors=16).save(png_path, optimize=True)
    return image.size


def build(*, check_only: bool = False) -> int:
    manifest: dict[str, dict[str, str]] = {}
    stale: list[str] = []
    previous: dict[str, dict[str, str]] = {}
    if MANIFEST.is_file():
        previous = json.loads(MANIFEST.read_text(encoding="utf-8")).get("backgrounds", {})

    for png_name, pdf_name in SOURCES.items():
        pdf_path = TEMPLATE_DIR / pdf_name
        png_path = PUBLIC_DIR / png_name
        if not pdf_path.is_file():
            raise SystemExit(f"底版不存在：{pdf_path}")
        source_sha = sha256_of(pdf_path)
        recorded = previous.get(png_name, {}).get("sourceSha256")
        if recorded != source_sha or not png_path.is_file():
            stale.append(png_name)
            if not check_only:
                width, height = render(pdf_path, png_path)
                print(f"rendered {png_name}  {width}x{height}  <- {pdf_name}")
        manifest[png_name] = {"source": pdf_name, "sourceSha256": source_sha}

    if check_only:
        if stale:
            print("以下底图与当前底版不一致：" + "、".join(stale))
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
        print("（底版没变，底图无需重渲染）")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="只检查底图是否与底版一致，不重新渲染；不一致时以非 0 退出。",
    )
    raise SystemExit(build(check_only=parser.parse_args().check))


if __name__ == "__main__":
    main()
