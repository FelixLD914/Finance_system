"""Salary Advance Employee Master Data table.

Revision ID: 20260805_0023
Revises: 20260805_0022
Create Date: 2026-08-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260805_0023"
down_revision: str | None = "20260805_0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "employees",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("emp_id", sa.String(length=80), nullable=False),
        sa.Column("first_name", sa.String(length=160), nullable=True),
        sa.Column("surname", sa.String(length=160), nullable=True),
        sa.Column("en_name", sa.String(length=300), nullable=True),
        sa.Column("chinese_name", sa.String(length=160), nullable=True),
        sa.Column("department", sa.String(length=160), nullable=True),
        sa.Column("position", sa.String(length=200), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("source_file_name", sa.String(length=260), nullable=True),
        sa.Column("created_by_name", sa.String(length=160), nullable=False),
        sa.Column("updated_by_name", sa.String(length=160), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_name", sa.String(length=160), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_salary_advance_employees"),
        schema="salary_advance",
    )
    op.create_index(
        "uq_salary_advance_employees_emp_id_live",
        "employees",
        ["emp_id"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
        schema="salary_advance",
    )
    op.create_index(
        "ix_salary_advance_employees_emp_id",
        "employees",
        ["emp_id"],
        unique=False,
        schema="salary_advance",
    )
    op.create_index(
        "ix_salary_advance_employees_en_name",
        "employees",
        ["en_name"],
        unique=False,
        schema="salary_advance",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_salary_advance_employees_en_name",
        table_name="employees",
        schema="salary_advance",
    )
    op.drop_index(
        "ix_salary_advance_employees_emp_id",
        table_name="employees",
        schema="salary_advance",
    )
    op.drop_index(
        "uq_salary_advance_employees_emp_id_live",
        table_name="employees",
        schema="salary_advance",
    )
    op.drop_table("employees", schema="salary_advance")
