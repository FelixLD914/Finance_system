import re
from dataclasses import dataclass

PERIOD_PATTERN = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


@dataclass(frozen=True)
class WhtNumber:
    task_no: str
    book_no: str


def compact_period(period: str) -> str:
    if not PERIOD_PATTERN.fullmatch(period):
        raise ValueError("period must use YYYY-MM and contain a valid month")
    return period.replace("-", "")


def build_normal_number(period: str, sequence: int) -> WhtNumber:
    if not 1 <= sequence <= 999:
        raise ValueError("normal sequence must be between 1 and 999")
    compact = compact_period(period)
    return WhtNumber(task_no=f"ZWT{compact}{sequence:03d}", book_no=compact)


def build_supplement_number(
    period: str,
    supplement_run: int,
    sequence: int,
) -> WhtNumber:
    if not 1 <= supplement_run <= 9:
        raise ValueError("supplement run must be between 1 and 9")
    if not 1 <= sequence <= 99:
        raise ValueError("supplement sequence must be between 1 and 99")
    compact = compact_period(period)
    short_period = compact[2:]
    return WhtNumber(
        task_no=f"ZWT{compact}BK{supplement_run}{sequence:02d}",
        book_no=f"{short_period}BK{supplement_run}",
    )
