"""拒批：税票加 'rejected' 状态 + rejected_at；未批准的可拒批进历史、可恢复。

业务口径 2026-07-30：复核台的「全不批 / 拒批」不硬删——像软删除一样，把未批准
（draft/needs_review/ready）的税票置为 rejected 进历史记录，可随时恢复回 needs_review
重新走复核批准。已批准/已开具的不走这条路：它们有正式编号，要作废得走 void→correction。

选状态位而不是加 deleted_at 软删列：rejected 天然落进「历史记录」这个状态分相，
恢复就是一次状态迁移，和现有 draft→…→issued/voided 的状态机是同一套东西。

Revision ID: 20260730_0015
Revises: 20260730_0014
Create Date: 2026-07-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260730_0015"
down_revision: str | None = "20260730_0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "tax_invoice"
_TABLE = "invoices"
# op.f() 只能在 upgrade/downgrade 里调用：模块导入时 Operations proxy 还没建立，
# 顶层调用会让 `alembic heads/history` 直接 NameError（见 0012 的同款注释）。
_CONSTRAINT = "ck_invoices_status_allowed"
_OLD = (
    "status IN ('draft', 'needs_review', 'ready', 'approved', 'issued', 'voided')"
)
_NEW = (
    "status IN ('draft', 'needs_review', 'ready', 'approved', 'issued', 'voided', "
    "'rejected')"
)


def upgrade() -> None:
    op.add_column(
        _TABLE,
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        schema=_SCHEMA,
    )
    constraint = op.f(_CONSTRAINT)
    op.drop_constraint(constraint, _TABLE, schema=_SCHEMA, type_="check")
    op.create_check_constraint(constraint, _TABLE, _NEW, schema=_SCHEMA)


def downgrade() -> None:
    # 回退前把 rejected 归回 needs_review：它们本就是未批准草稿，归位不丢信息，
    # 否则旧约束（不含 rejected）建不起来。
    op.execute(
        f"UPDATE {_SCHEMA}.{_TABLE} "
        "SET status = 'needs_review', rejected_at = NULL WHERE status = 'rejected'"
    )
    constraint = op.f(_CONSTRAINT)
    op.drop_constraint(constraint, _TABLE, schema=_SCHEMA, type_="check")
    op.create_check_constraint(constraint, _TABLE, _OLD, schema=_SCHEMA)
    op.drop_column(_TABLE, "rejected_at", schema=_SCHEMA)
