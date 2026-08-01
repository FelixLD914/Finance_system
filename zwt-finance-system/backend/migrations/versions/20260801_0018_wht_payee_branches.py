"""Add structured WHT payee head-office / branch data and task snapshots.

Revision ID: 20260801_0018
Revises: 20260801_0017
Create Date: 2026-08-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260801_0018"
down_revision: str | None = "20260801_0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _add_columns(table: str) -> None:
    op.add_column(
        table,
        sa.Column(
            "branch_type",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'none'"),
        ),
        schema="wht",
    )
    op.add_column(
        table,
        sa.Column("branch_number", sa.String(length=5), nullable=True),
        schema="wht",
    )
    op.create_check_constraint(
        f"{table}_branch_type_allowed",
        table,
        "branch_type IN ('none', 'head_office', 'branch')",
        schema="wht",
    )
    op.create_check_constraint(
        f"{table}_branch_number_matches_type",
        table,
        "(branch_type = 'branch' AND branch_number ~ '^[0-9]{5}$') OR "
        "(branch_type <> 'branch' AND branch_number IS NULL)",
        schema="wht",
    )


def upgrade() -> None:
    _add_columns("payees")
    _add_columns("tasks")
    # 现有主数据（包含已软删除记录）中的 PND53 都先按总公司迁移，随后可在
    # 主数据页改成具体分支。约束覆盖整张表，因此不能遗漏软删除记录。
    # 历史任务保持 none，避免重新导出旧票时凭空改变当年的公司名称。
    op.execute(
        "UPDATE wht.payees SET branch_type = 'head_office' "
        "WHERE wht_type = 'PND53'"
    )
    op.create_check_constraint(
        "payees_branch_matches_wht_type",
        "payees",
        "(wht_type = 'PND53' AND branch_type IN ('head_office', 'branch')) OR "
        "(wht_type = 'PND3' AND branch_type = 'none')",
        schema="wht",
    )


def downgrade() -> None:
    op.drop_constraint("payees_branch_matches_wht_type", "payees", schema="wht")
    for table in ("tasks", "payees"):
        op.drop_constraint(f"{table}_branch_number_matches_type", table, schema="wht")
        op.drop_constraint(f"{table}_branch_type_allowed", table, schema="wht")
        op.drop_column(table, "branch_number", schema="wht")
        op.drop_column(table, "branch_type", schema="wht")
