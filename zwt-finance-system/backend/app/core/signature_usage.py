"""签名适用范围：一张签名可以同时挂在多个单据模块上。

历史上这里是单值枚举（wht / tax_inv / both）。加入工资预支后 "both" 这个名字
就不成立了——"两者"到底是哪两个？所以改成模块集合，序列化为逗号分隔的有序
字符串存库（migration 20260728_0011 把旧的 both 迁成 "tax_inv,wht"）。

成员判定一律走这里的函数，不要在 SQL 里对逗号串做 LIKE：模块名今天互不为
子串纯属巧合，加一个新模块就可能踩中。签名资产只有几十行，取出来在
Python 里过滤代价可以忽略。
"""

from collections.abc import Iterable
from typing import Final

# 顺序即序列化顺序，保证同一集合始终得到同一个字符串。
SIGNATURE_MODULES: Final[tuple[str, ...]] = (
    "wht",
    "tax_inv",
    "salary_advance",
    "salary_advance_finance",
    "salary_advance_md",
)


def parse_signature_usage(value: str | None) -> set[str]:
    """把库里的字符串解析成模块集合，顺带兼容迁移前的 both 及预支单细分角色。"""
    modules = {item.strip() for item in (value or "").split(",") if item.strip()}
    if "both" in modules:
        modules.discard("both")
        modules.update({"wht", "tax_inv"})
    result = {module for module in modules if module in SIGNATURE_MODULES}

    # 展开通用与细分角色的双向兼容：
    # 1. 声明为 salary_advance 的通用签名自动覆盖财务负责人 (salary_advance_finance) 与董事 (salary_advance_md)
    if "salary_advance" in result:
        result.update({"salary_advance_finance", "salary_advance_md"})
    # 2. 声明了细分角色 (salary_advance_finance 或 salary_advance_md) 的签名，其模块归属包含 salary_advance
    if "salary_advance_finance" in result or "salary_advance_md" in result:
        result.add("salary_advance")

    return result


def format_signature_usage(modules: Iterable[str]) -> str:
    """把模块集合序列化回库里的字符串；空集合是无意义的，直接拒绝。"""
    unique = {module for module in modules if module in SIGNATURE_MODULES}
    if not unique:
        raise ValueError("signature usage must name at least one module")
    return ",".join(module for module in SIGNATURE_MODULES if module in unique)


def signature_allows(value: str | None, module: str) -> bool:
    """这张签名能不能盖在 module 的单据或指定角色位置上。"""
    return module in parse_signature_usage(value)


def signature_usages_overlap(left: str | None, right: str | None) -> bool:
    """两张签名的适用范围是否有交集——默认签名互斥就按这个判定。"""
    return bool(parse_signature_usage(left) & parse_signature_usage(right))


# 会把签名人姓名印在单据上的模块。目前只有工资预支单：它在签名横线下方印
# "( 姓名 )"；WHT 与 TAX INV 的单据上只有签名图，不出现姓名。
SIGNER_NAME_MODULES: Final[frozenset[str]] = frozenset(
    {"salary_advance", "salary_advance_finance", "salary_advance_md"}
)


def requires_signer_name(value: str | None) -> bool:
    """这张签名要不要填签名人姓名。

    判据是适用范围里有没有会印姓名的单据——勾了工资预支就必须填，因为那个名字
    要原样印到单据上；只用于 WHT / TAX INV 的签名不需要，强制填只会造无用数据。
    """
    return bool(parse_signature_usage(value) & SIGNER_NAME_MODULES)

