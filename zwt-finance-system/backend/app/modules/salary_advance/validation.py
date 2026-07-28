from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

from app.modules.salary_advance.bahttext import bahttext

HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "row_no": ("序号", "row_no", "Row No", "Row No."),
    "period": ("期间", "period", "Period", "YYYYMM"),
    "emp_id": ("Emp.ID 工号", "Emp.ID\n工号", "Emp ID", "Employee ID", "工号", "emp_id"),
    "en_name": (
        "EN Name 英文名字",
        "EN Name\n英文名字",
        "EN Name",
        "English Name",
        "英文名字",
        "en_name",
    ),
    "department": ("Dept 部门", "Dept\n部门", "Dept", "Department", "部门", "department"),
    "position": ("Position 职位", "Position\n职位", "Position", "职位", "position"),
    "advance_amount": ("预支金额", "Advance Amount", "advance_amount"),
    "request_date": ("签字日期", "Request Date", "request_date", "申请日期"),
    "start_date": ("开始工作日期", "Start Date", "start_date", "开始日期", "入职日期"),
    "first_name": ("名 First Name", "名", "First Name", "first_name"),
    "surname": ("姓 Surname", "姓", "Surname", "surname"),
    "finance_display_name": (
        "财务签字人",
        "财务签字",
        "Finance Signer",
        "finance_display_name",
    ),
    "md_display_name": ("总经理签字人", "总经理签字", "MD Signer", "md_display_name"),
    "chinese_name": ("中文名", "Chinese Name", "chinese_name"),
    "applicant_display_name": (
        "申请人显示名（泰文/英文）",
        "申请人显示名",
        "applicant_display_name",
    ),
    "reason": ("申请原因", "Reason", "reason"),
    "monthly_deduction": ("每月扣款金额", "Monthly Deduction", "monthly_deduction"),
    "advance_amount_words_th": (
        "金额泰文大写（可空）",
        "金额泰文大写",
        "advance_amount_words_th",
    ),
    "monthly_deduction_words_th": (
        "每月扣款泰文大写（可空）",
        "每月扣款泰文大写",
        "monthly_deduction_words_th",
    ),
    "finance_comment": ("财务意见", "Finance Comment", "finance_comment"),
    "approval_status": ("审批结果", "Approval Status", "approval_status"),
    "applicant_signature_mode": (
        "申请人签名方式",
        "Applicant Signature Mode",
        "applicant_signature_mode",
    ),
    "finance_signature_code": (
        "财务签名代码",
        "Finance Signature Code",
        "finance_signature_code",
    ),
    "md_signature_code": ("总经理签名代码", "MD Signature Code", "md_signature_code"),
    "finance_date": ("财务签字日期", "Finance Date", "finance_date"),
    "md_date": ("总经理签字日期", "MD Date", "md_date"),
    "output_filename": ("输出文件名（可空）", "输出文件名", "output_filename"),
    "remark": ("备注", "Remark", "remark"),
}

FIELD_ORDER: tuple[str, ...] = tuple(HEADER_ALIASES)
MONEY_QUANTUM = Decimal("0.01")
FORMULA_PREFIXES = ("=", "+", "-", "@")


def _header_key(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or "")).casefold()


def map_headers(values: list[Any] | tuple[Any, ...]) -> dict[str, int]:
    alias_index = {
        _header_key(alias): field
        for field, aliases in HEADER_ALIASES.items()
        for alias in aliases
    }
    mapping: dict[str, int] = {}
    for index, value in enumerate(values):
        field = alias_index.get(_header_key(value))
        if field is not None and field not in mapping:
            mapping[field] = index
    return mapping


def normalize_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def parse_date(value: Any) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = normalize_text(value)
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%d-%m-%Y", "%Y%m%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def parse_decimal(value: Any) -> Decimal:
    if value is None or normalize_text(value) == "":
        return Decimal("0")
    return Decimal(str(value).replace(",", "").strip()).quantize(
        MONEY_QUANTUM,
        rounding=ROUND_HALF_UP,
    )


def safe_excel_text(value: Any) -> str:
    text = str(value or "")
    return f"'{text}" if text.startswith(FORMULA_PREFIXES) else text


def _issue(field: str, code: str, message: str) -> dict[str, str]:
    return {"field": field, "code": code, "message": message}


def _resolve_signer_codes(
    data: dict[str, Any],
    errors: list[dict[str, str]],
    warnings: list[dict[str, str]],
) -> tuple[str, str]:
    """从签名代码或签字人姓名确定财务/总经理签名代码。

    只做确定性的姓名→代码映射，绝不按期间、月份等无关字段猜签名人——
    正式单据上盖错签名比导入失败严重得多。
    """
    finance_code = normalize_text(data.get("finance_signature_code")).upper()
    finance_name = normalize_text(data.get("finance_display_name"))
    if not finance_code:
        if not finance_name or "邢兰慧" in finance_name or "LANHUI" in finance_name.upper():
            # 本业务的财务签字人固定为邢兰慧（与旧工具口径一致），
            # 留空时默认之，但要在校验报告里可见。
            finance_code = "FIN_XING_LANHUI"
            warnings.append(
                _issue(
                    "finance_signature_code",
                    "DEFAULTED",
                    "财务签名代码已按默认签字人邢兰慧填入",
                )
            )
        else:
            errors.append(
                _issue(
                    "finance_signature_code",
                    "SIGNER_UNKNOWN",
                    f"无法从财务签字人「{finance_name}」确定签名代码，请填写签名代码",
                )
            )

    md_code = normalize_text(data.get("md_signature_code")).upper()
    md_name = normalize_text(data.get("md_display_name"))
    if not md_code:
        md_upper = md_name.upper()
        if "龚尧文" in md_name or "YAOWEN" in md_upper:
            md_code = "MD_GONG_YAOWEN"
        elif "朱发坚" in md_name or "FAJIAN" in md_upper:
            md_code = "MD_ZHU_FAJIAN"
        else:
            errors.append(
                _issue(
                    "md_signature_code",
                    "SIGNER_UNKNOWN",
                    "无法确定总经理签名代码，请填写总经理签字人或签名代码",
                )
            )
    return finance_code, md_code


def validate_and_normalize_record(
    raw: dict[str, Any],
    *,
    batch_period: str | None = None,
    active_signature_codes: set[str] | None = None,
) -> tuple[str, list[dict[str, str]], list[dict[str, str]], dict[str, Any]]:
    errors: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    normalized: dict[str, Any] = {}

    period = normalize_text(raw.get("period")) or normalize_text(batch_period)
    if not re.fullmatch(r"\d{6}", period):
        errors.append(_issue("period", "INVALID_FORMAT", "期间格式必须为 YYYYMM"))
    elif not 1 <= int(period[4:]) <= 12:
        errors.append(_issue("period", "INVALID_VALUE", "期间月份必须介于 01 与 12"))
    normalized["period"] = period

    emp_id = normalize_text(raw.get("emp_id"))
    if not emp_id:
        errors.append(_issue("emp_id", "REQUIRED", "工号为必填项"))
    normalized["emp_id"] = emp_id

    first_name = normalize_text(raw.get("first_name"))
    surname = normalize_text(raw.get("surname"))
    en_name = normalize_text(raw.get("en_name"))
    if not first_name:
        errors.append(_issue("first_name", "REQUIRED", "名为必填项"))
    if not surname:
        errors.append(_issue("surname", "REQUIRED", "姓为必填项"))
    combined_name = normalize_text(f"{first_name} {surname}").upper()
    if not en_name and combined_name:
        en_name = combined_name
    elif en_name and combined_name and en_name.upper() != combined_name:
        warnings.append(_issue("en_name", "NAME_MISMATCH", "英文名与名、姓拼接结果不一致"))
    normalized.update(first_name=first_name, surname=surname, en_name=en_name)

    chinese_name = normalize_text(raw.get("chinese_name"))
    if not chinese_name:
        warnings.append(_issue("chinese_name", "MISSING", "中文名为空"))
    normalized["chinese_name"] = chinese_name

    applicant_name = normalize_text(raw.get("applicant_display_name")) or en_name
    if not normalize_text(raw.get("applicant_display_name")):
        warnings.append(_issue("applicant_display_name", "DEFAULTED", "申请人显示名已使用英文名"))
    normalized["applicant_display_name"] = applicant_name

    for field, label in (("department", "部门"), ("position", "职位")):
        value = normalize_text(raw.get(field))
        if not value:
            errors.append(_issue(field, "REQUIRED", f"{label}为必填项"))
        normalized[field] = value
    if len(normalized["position"]) > 50:
        warnings.append(_issue("position", "TEXT_TOO_LONG", "职位过长，表单中可能缩小显示"))

    reason = normalize_text(raw.get("reason"))
    if not reason:
        reason = "生活开支 / Living expenses"
        warnings.append(_issue("reason", "DEFAULTED", "申请原因已使用默认值"))
    if len(reason) > 100:
        warnings.append(_issue("reason", "TEXT_TOO_LONG", "申请原因过长，表单中可能换行"))
    normalized["reason"] = reason

    request_date = parse_date(raw.get("request_date"))
    start_date = parse_date(raw.get("start_date"))
    if request_date is None:
        errors.append(_issue("request_date", "INVALID_DATE", "申请日期缺失或无法解析"))
    if start_date is None:
        errors.append(_issue("start_date", "INVALID_DATE", "入职日期缺失或无法解析"))
    if request_date and start_date and start_date > request_date:
        errors.append(_issue("start_date", "DATE_CHRONOLOGY", "入职日期不能晚于申请日期"))
    normalized["request_date"] = request_date.isoformat() if request_date else None
    normalized["start_date"] = start_date.isoformat() if start_date else None

    try:
        advance_amount = parse_decimal(raw.get("advance_amount"))
        if advance_amount <= 0:
            errors.append(_issue("advance_amount", "INVALID_AMOUNT", "预支金额必须大于零"))
    except (InvalidOperation, ValueError):
        advance_amount = Decimal("0")
        errors.append(_issue("advance_amount", "PARSE_ERROR", "预支金额格式错误"))

    monthly_value = raw.get("monthly_deduction")
    try:
        if monthly_value is None or normalize_text(monthly_value) == "":
            monthly_deduction = advance_amount
            warnings.append(_issue("monthly_deduction", "DEFAULTED", "每月扣款已默认等于预支金额"))
        else:
            monthly_deduction = parse_decimal(monthly_value)
        if monthly_deduction <= 0:
            errors.append(_issue("monthly_deduction", "INVALID_AMOUNT", "每月扣款必须大于零"))
        elif monthly_deduction > advance_amount:
            errors.append(_issue("monthly_deduction", "EXCEEDS_LIMIT", "每月扣款不能大于预支金额"))
    except (InvalidOperation, ValueError):
        monthly_deduction = Decimal("0")
        errors.append(_issue("monthly_deduction", "PARSE_ERROR", "每月扣款格式错误"))

    normalized["advance_amount"] = str(advance_amount)
    normalized["monthly_deduction"] = str(monthly_deduction)
    for field, amount in (
        ("advance_amount_words_th", advance_amount),
        ("monthly_deduction_words_th", monthly_deduction),
    ):
        supplied = normalize_text(raw.get(field))
        generated = bahttext(amount)
        if supplied and supplied != generated:
            warnings.append(_issue(field, "WORDS_MISMATCH", "手填泰文金额与系统换算结果不一致"))
        normalized[field] = supplied or generated

    approval_status = normalize_text(raw.get("approval_status")) or "Pending"
    if approval_status not in {"Approve", "Not approved", "Pending"}:
        errors.append(
            _issue(
                "approval_status",
                "INVALID_VALUE",
                "审批结果只能是 Approve、Not approved 或 Pending",
            )
        )
    normalized["approval_status"] = approval_status

    finance_code, md_code = _resolve_signer_codes(raw, errors, warnings)
    finance_name = normalize_text(raw.get("finance_display_name"))
    md_name = normalize_text(raw.get("md_display_name"))
    normalized["finance_display_name"] = finance_name or "邢兰慧"
    if md_name:
        normalized["md_display_name"] = md_name
    elif md_code == "MD_GONG_YAOWEN":
        normalized["md_display_name"] = "龚尧文"
    elif md_code == "MD_ZHU_FAJIAN":
        normalized["md_display_name"] = "朱发坚"
    else:
        normalized["md_display_name"] = ""
    normalized["finance_signature_code"] = finance_code
    normalized["md_signature_code"] = md_code

    if active_signature_codes is not None:
        for field, code in (
            ("finance_signature_code", finance_code),
            ("md_signature_code", md_code),
        ):
            # 代码本身缺失时上面已报 SIGNER_UNKNOWN，不再叠加一条。
            if code and code not in active_signature_codes:
                errors.append(
                    _issue(
                        field,
                        "SIGNATURE_NOT_FOUND",
                        f"签名库中没有名为 {code} 的有效签名，请在系统管理 → 签名库维护",
                    )
                )

    finance_date = parse_date(raw.get("finance_date")) or request_date
    md_date = parse_date(raw.get("md_date")) or request_date
    if raw.get("finance_date") in (None, "") and finance_code:
        warnings.append(_issue("finance_date", "DEFAULTED", "财务签字日期已默认等于申请日期"))
    if raw.get("md_date") in (None, "") and md_code:
        warnings.append(_issue("md_date", "DEFAULTED", "总经理签字日期已默认等于申请日期"))
    normalized["finance_date"] = finance_date.isoformat() if finance_date else None
    normalized["md_date"] = md_date.isoformat() if md_date else None
    normalized["finance_comment"] = normalize_text(raw.get("finance_comment"))

    signature_mode = normalize_text(raw.get("applicant_signature_mode")) or "Handwritten"
    if signature_mode != "Handwritten":
        errors.append(
            _issue("applicant_signature_mode", "INVALID_MODE", "申请人签名方式必须为 Handwritten")
        )
    normalized["applicant_signature_mode"] = "Handwritten"

    output_name = normalize_text(raw.get("output_filename"))
    if output_name:
        output_name = re.sub(r'[\\/:*?"<>|\'`!@]', "", output_name).replace("..", "")
        output_name = output_name.lstrip("=+-").strip()
    if not output_name:
        name = chinese_name or en_name
        output_name = f"{period}_{emp_id}_{name}_工资预支单"
    normalized["output_filename"] = output_name[:180]
    normalized["remark"] = normalize_text(raw.get("remark"))
    normalized["row_no"] = raw.get("row_no")

    status = "invalid" if errors else "warning" if warnings else "valid"
    return status, errors, warnings, normalized


def data_fingerprint(normalized: dict[str, Any]) -> str:
    payload = json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
