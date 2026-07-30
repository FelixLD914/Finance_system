"""税票加报关单侧留痕字段：海关汇率、货代名称、出口泰铢金额。

业务口径 2026-07-30：净重与 HS 不纳入核对；在原桌面版基础上增加

  - 海关汇率（报关单自印的 `1.00 USD = 31.062700 THB`）
  - 货代名称（泰文原文 + 英文名 + 报关行税号）
  - 出口泰铢金额（行级加总与报关单底部自印合计**分开存**，两者互为核对）

这些字段一律不参与计价——计价汇率仍取 BOT 表，口径不变。它们是核对用的，
并且要出现在导出核对表里，所以必须落库而不是只在识别响应里返回一次。

顺带把 submission_date_confidence 从 20 放宽到 24：可信度改用 BOI 那套分级
（trusted_exact / needs_review_repaired / …）之后，最长的值有 21 个字符，
留在 20 会在导入时被数据库截断或直接报错。

Revision ID: 20260730_0014
Revises: 20260729_0013
Create Date: 2026-07-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260730_0014"
down_revision: str | None = "20260729_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "tax_invoice"
_TABLE = "invoices"

# (列名, 类型)。全部可空：存量税票没有这些值，回填要靠重新识别，不能给默认值
# 假装它们有——0.00 的"海关汇率"比空值更容易骗过对账的人。
_COLUMNS: tuple[tuple[str, sa.types.TypeEngine], ...] = (
    ("declaration_ref_no", sa.String(length=60)),
    ("customs_exchange_rate", sa.Numeric(precision=18, scale=6)),
    ("forwarder_name", sa.String(length=300)),
    ("forwarder_name_th", sa.String(length=300)),
    ("forwarder_name_en", sa.String(length=300)),
    ("forwarder_tax_no", sa.String(length=20)),
    ("customs_fob_usd_total", sa.Numeric(precision=20, scale=2)),
    ("customs_fob_thb_line_total", sa.Numeric(precision=20, scale=2)),
    ("customs_fob_thb_printed_total", sa.Numeric(precision=20, scale=2)),
)


def upgrade() -> None:
    for name, column_type in _COLUMNS:
        op.add_column(
            _TABLE,
            sa.Column(name, column_type, nullable=True),
            schema=_SCHEMA,
        )
    op.alter_column(
        _TABLE,
        "submission_date_confidence",
        existing_type=sa.String(length=20),
        type_=sa.String(length=24),
        existing_nullable=True,
        schema=_SCHEMA,
    )


def downgrade() -> None:
    # 先收窄再删列。收窄前把超长值截断——降级回 0013 之后跑的是旧代码，
    # 它只认 high/medium/low，留着 needs_review_repaired 也没人读得懂。
    op.execute(
        f"UPDATE {_SCHEMA}.{_TABLE} "
        "SET submission_date_confidence = LEFT(submission_date_confidence, 20) "
        "WHERE submission_date_confidence IS NOT NULL"
    )
    op.alter_column(
        _TABLE,
        "submission_date_confidence",
        existing_type=sa.String(length=24),
        type_=sa.String(length=20),
        existing_nullable=True,
        schema=_SCHEMA,
    )
    for name, _ in reversed(_COLUMNS):
        op.drop_column(_TABLE, name, schema=_SCHEMA)
