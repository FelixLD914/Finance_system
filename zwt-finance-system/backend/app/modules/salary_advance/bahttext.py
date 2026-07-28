from decimal import ROUND_HALF_UP, Decimal

THAI_DIGITS = ("", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า")
THAI_UNITS = ("", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน")


def _block_text(value: int, *, follows_million: bool = False) -> str:
    digits = f"{value:06d}"
    parts: list[str] = []
    for index, character in enumerate(digits):
        digit = int(character)
        if digit == 0:
            continue
        position = 5 - index
        if position == 1:
            if digit == 1:
                parts.append("สิบ")
            elif digit == 2:
                parts.append("ยี่สิบ")
            else:
                parts.append(f"{THAI_DIGITS[digit]}สิบ")
        elif position == 0 and digit == 1:
            has_preceding = follows_million or any(int(item) for item in digits[:index])
            parts.append("เอ็ด" if has_preceding else "หนึ่ง")
        else:
            parts.append(f"{THAI_DIGITS[digit]}{THAI_UNITS[position]}")
    return "".join(parts)


def bahttext(amount: Decimal) -> str:
    """把金额转换为泰文大写，行为与来源工资预支工具一致。"""

    amount = Decimal(amount).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if amount < 0:
        return f"ลบ{bahttext(-amount)}"
    if amount == 0:
        return "ศูนย์บาทถ้วน"

    baht = int(amount)
    satang = int((amount - Decimal(baht)) * 100)
    groups: list[int] = []
    while baht:
        groups.append(baht % 1_000_000)
        baht //= 1_000_000
    groups.reverse()

    integer_parts: list[str] = []
    for index, group in enumerate(groups):
        text = _block_text(group, follows_million=index > 0)
        if text:
            integer_parts.append(text)
        if index < len(groups) - 1:
            integer_parts.append("ล้าน")

    integer_text = "".join(integer_parts)
    if satang == 0:
        return f"{integer_text}บาทถ้วน"
    satang_text = _block_text(satang, follows_million=bool(integer_text))
    if integer_text:
        return f"{integer_text}บาท{satang_text}สตางค์"
    return f"{satang_text}สตางค์"
