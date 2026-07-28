"""Drop the unused wht_tasks.document_count column

Revision ID: 20260728_0009
Revises: 20260728_0008
Create Date: 2026-07-28

document_count 从初始提交起就是个死字段：不在 WHT 模板的任何占位符里、
不在旧系统 Data.xlsx 的列里、生成的凭证上不出现，历史迁移还直接写死 1。
界面上叫「文件数量」，但没人能说清是哪种文件——业务确认后决定整列删除。

若日后业务定义了"一张凭证涵盖几份付款单据"这类含义，重新加列即可，
downgrade 会把列按原样（NOT NULL DEFAULT 1 + 非负约束）建回来。
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260728_0009"
down_revision: str | None = "20260728_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 必须套 op.f()：naming_convention 会给未标记的名字再加一次 ck_%(table_name)s_
    # 前缀，直接传字符串会变成 ck_tasks_ck_tasks_...。建这条约束时也用的 op.f()。
    op.drop_constraint(
        op.f("ck_tasks_document_count_non_negative"),
        "tasks",
        schema="wht",
        type_="check",
    )
    op.drop_column("tasks", "document_count", schema="wht")


def downgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column(
            "document_count",
            sa.Integer(),
            nullable=False,
            server_default="1",
        ),
        schema="wht",
    )
    op.alter_column("tasks", "document_count", server_default=None, schema="wht")
    op.create_check_constraint(
        op.f("ck_tasks_document_count_non_negative"),
        "tasks",
        "document_count >= 0",
        schema="wht",
    )
