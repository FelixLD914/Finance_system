"""Excel 单元格取值的共用助手。

历史台账迁移（legacy_import）与批量开具导入（batch_import）读的是两种不同的表，
但「Excel 单元格 → Python 值」的坑是同一批：openpyxl 把整数读成 float、
日期可能是 datetime 也可能是字符串、金额带千分位逗号、税号可能丢前导零。
两处各写一遍迟早会出现只修好一边的情况，所以统一放这里。
"""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from io import BytesIO
from typing import Any

from openpyxl import load_workbook

# 只认年在前的写法。日/月在前的 05/06/2026 无法区分 5 月 6 日和 6 月 5 日，
# 税务日期一旦解析错方向不会报错、只会静默出错，因此宁可拒收。
DATE_FORMATS = ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S")


class WorkbookError(ValueError):
    """上传的工作簿不符合约定。消息会原样回给前端，写成可执行的指引。"""


def text(value: Any) -> str:
    if value is None:
        return ""
    # openpyxl 把 "1" 这样的数字单元格读成 1.0，直接 str() 会得到 "1.0"。
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def tax_id(value: Any) -> str:
    digits = re.sub(r"\D", "", text(value))
    # Excel 常把 0105540057561 当数字存，前导零会丢，补回 13 位。
    if digits and len(digits) < 13:
        digits = digits.zfill(13)
    return digits


def split_aliases(value: Any) -> list[str]:
    raw = text(value)
    if not raw:
        return []
    return list(dict.fromkeys(part.strip() for part in re.split(r"[/\n\r]+", raw) if part.strip()))


def decimal_value(value: Any, default: str = "0") -> Decimal:
    raw = text(value).replace(",", "")
    if not raw:
        return Decimal(default)
    try:
        return Decimal(raw)
    except InvalidOperation as exc:
        raise WorkbookError(f"invalid decimal value: {value}") from exc


def date_value(value: Any) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    raw = text(value).replace("/", "-")
    for date_format in DATE_FORMATS:
        try:
            return datetime.strptime(raw, date_format).date()
        except ValueError:
            continue
    raise WorkbookError(f"invalid date value: {value}")


def load(content: bytes):
    try:
        return load_workbook(BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:
        raise WorkbookError("the uploaded file is not a readable XLSX workbook") from exc
