"""出票前对签名图做的那一道处理：清底、去扫描下划线、转蓝墨、裁到墨迹外接框。

**三种单据（WHT / TAX INV / 工资预支）走同一份实现**，出来的观感必须一致：
同一张签名在三张单据上应该是同一支笔写的。

裁到墨迹外接框这一步是关键：`drawImage(..., preserveAspectRatio=True)` 把整张图
等比适配进签名框，所以**图四周的留白会照比例占掉签名框**。导出的签名 PNG 基本都
带留白，不裁的话同一张图在不同单据上大小差好几倍——2026-08-05 实测，一张四周留白
的签名在 WHT 的 95pt 框里撑满 93.6pt，在工资预支的 90pt 框里只有 34.1pt，用户直接
反馈"工资预支单签名过小"。裁掉留白之后，签名框多大就印多大。

这段逻辑原先只长在 wht.document_generator 里（tax_invoice 跨模块 import 它），
工资预支要用就成了第三个跨模块 import，所以挪到 core。
"""

from __future__ import annotations

from pathlib import Path

# 判定"这是背景不是墨"的阈值：RGB 三通道都 >= 245 视为近白。扫描件的纸面不是
# 纯白，卡在 255 会把整张纸当墨。
_NEAR_WHITE = 245
# 转成灰度后低于这个墨力度的像素当噪点丢掉（抗锯齿边缘的极淡灰）。
_MIN_INK_STRENGTH = 14
# 裁剪时在墨迹外接框外留的像素，避免把笔画边缘的抗锯齿削掉。
_CROP_PADDING = 2


class SignatureImageError(RuntimeError):
    """签名图处理失败。调用方各自包装成本模块的错误类型。"""


def build_blue_signature(source_path: Path, target_path: Path) -> None:
    """把签名图处理成可直接套印的蓝色墨迹 PNG（已裁到墨迹外接框）。"""
    try:
        from PIL import Image

        with Image.open(source_path) as image:
            rgba = image.convert("RGBA")
            width, height = rgba.size
            flattened_data = getattr(rgba, "get_flattened_data", None)
            pixels = list(flattened_data() if flattened_data is not None else rgba.getdata())

            def is_ink(pixel: tuple[int, int, int, int]) -> bool:
                red, green, blue, alpha = pixel
                return alpha > 0 and not (
                    red >= _NEAR_WHITE and green >= _NEAR_WHITE and blue >= _NEAR_WHITE
                )

            ink_mask = [is_ink(pixel) for pixel in pixels]
            # 扫描并剔除扫描件/截图里常见的签名下划线。规则只处理横跨至少
            # 45% 图片、且像素高度很薄的近水平连续线，不会把普通签名字迹抹掉。
            minimum_rule_width = max(24, int(width * 0.45))
            removed_pixels: set[int] = set()
            for y in range(height):
                row_start = y * width
                run_start: int | None = None
                for x in range(width + 1):
                    occupied = x < width and ink_mask[row_start + x]
                    if occupied and run_start is None:
                        run_start = x
                    if occupied or run_start is None:
                        continue
                    if x - run_start >= minimum_rule_width:
                        removed_pixels.update(range(row_start + run_start, row_start + x))
                    run_start = None

            converted = []
            for index, (red, green, blue, alpha) in enumerate(pixels):
                if index in removed_pixels or not ink_mask[index]:
                    converted.append((255, 255, 255, 0))
                    continue
                luminance = (299 * red + 587 * green + 114 * blue) // 1000
                ink_strength = 255 - luminance
                if ink_strength < _MIN_INK_STRENGTH:
                    converted.append((255, 255, 255, 0))
                    continue
                converted.append(
                    (
                        20,
                        70,
                        min(255, 210 + int((ink_strength / 255) * 25)),
                        # 不透明度按墨力度走：淡的地方淡、浓的地方浓，看着才像盖上去的。
                        # 原图本来就有 alpha（去过背的 PNG）时取较大值，别把它削薄。
                        max(alpha, min(255, int(ink_strength * 1.7))),
                    )
                )
            rgba.putdata(converted)
            alpha_box = rgba.getchannel("A").getbbox()
            if alpha_box is None:
                raise SignatureImageError("signature image contains no usable ink")
            left = max(0, alpha_box[0] - _CROP_PADDING)
            top = max(0, alpha_box[1] - _CROP_PADDING)
            right = min(width, alpha_box[2] + _CROP_PADDING)
            bottom = min(height, alpha_box[3] + _CROP_PADDING)
            rgba.crop((left, top, right, bottom)).save(target_path, format="PNG")
    except Exception as exc:
        raise SignatureImageError("signature image preparation failed") from exc
