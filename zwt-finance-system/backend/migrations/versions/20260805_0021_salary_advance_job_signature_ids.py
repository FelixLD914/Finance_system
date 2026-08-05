"""Per-job finance / MD signature selection on salary advance generation jobs.

模型（models.SalaryAdvanceGenerationJob）在 9ba5524 就加了这两列并进了
create_job 的 INSERT，但没有配套 DDL；已迁到 0020 的库上一建任务就
UndefinedColumn 500。这条补齐 DDL。

可空是有意的：历史任务没有"当时选了哪张签名"这个信息，回填任何值都是编造。
NULL 的语义就是"按 _resolve_signature 的兜底顺序解析"，与旧行为一致。

Revision ID: 20260805_0021
Revises: 20260804_0020
Create Date: 2026-08-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260805_0021"
down_revision: str | None = "20260804_0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "generation_jobs",
        sa.Column("finance_signature_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="salary_advance",
    )
    op.add_column(
        "generation_jobs",
        sa.Column("md_signature_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="salary_advance",
    )
    # 外键名与 models.py 里写死的一致，且与本表既有外键同一套命名法；
    # 不用 op.f() 自动命名——Postgres 上实际落地的名字未必是你以为的那个（见 0020）。
    op.create_foreign_key(
        "fk_salary_advance_jobs_finance_sig_asset",
        "generation_jobs",
        "signature_assets",
        ["finance_signature_id"],
        ["id"],
        source_schema="salary_advance",
        referent_schema="core",
    )
    op.create_foreign_key(
        "fk_salary_advance_jobs_md_sig_asset",
        "generation_jobs",
        "signature_assets",
        ["md_signature_id"],
        ["id"],
        source_schema="salary_advance",
        referent_schema="core",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_salary_advance_jobs_md_sig_asset",
        "generation_jobs",
        schema="salary_advance",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_salary_advance_jobs_finance_sig_asset",
        "generation_jobs",
        schema="salary_advance",
        type_="foreignkey",
    )
    op.drop_column("generation_jobs", "md_signature_id", schema="salary_advance")
    op.drop_column("generation_jobs", "finance_signature_id", schema="salary_advance")
