"""主数据软删除（回收站）：收款方、签名图库、汇率。

三张主数据表加 deleted_at / deleted_by_name。汇率另加 is_active（此前它是三者中
唯一没有启停开关的）。

唯一键逐表处理，理由见 app.core.soft_delete 的模块注释：
  - wht.payees.tax_id                     → 部分唯一索引，删除即释放税号
  - core.exchange_rates (currency, date)  → 部分唯一索引，否则「删了再重导」会
                                            命中已删除行，导入报成功但界面没数据
  - core.signature_assets                 → 两个唯一约束原样保留

Revision ID: 20260729_0013
Revises: 20260728_0012
Create Date: 2026-07-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260729_0013"
down_revision: str | None = "20260728_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (schema, table) —— 三张表都要的两列
_SOFT_DELETE_TABLES = (
    ("wht", "payees"),
    ("core", "signature_assets"),
    ("core", "exchange_rates"),
)


def upgrade() -> None:
    for schema, table in _SOFT_DELETE_TABLES:
        op.add_column(
            table,
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            schema=schema,
        )
        op.add_column(
            table,
            sa.Column("deleted_by_name", sa.String(length=160), nullable=True),
            schema=schema,
        )

    # 汇率补启停开关。已有行一律视为启用——此前没有这个概念，全部都在用。
    op.add_column(
        "exchange_rates",
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        schema="core",
    )

    # 收款方税号：全表唯一约束 → 只约束未删除行的部分唯一索引。
    op.drop_constraint("uq_wht_payees_tax_id", "payees", schema="wht", type_="unique")
    op.create_index(
        "uq_wht_payees_tax_id_live",
        "payees",
        ["tax_id"],
        unique=True,
        schema="wht",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    # 汇率 (currency, rate_date) 同上。
    op.drop_constraint(
        "uq_core_exchange_rates_currency_date",
        "exchange_rates",
        schema="core",
        type_="unique",
    )
    op.create_index(
        "uq_core_exchange_rates_currency_date_live",
        "exchange_rates",
        ["currency", "rate_date"],
        unique=True,
        schema="core",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    # 回退前必须物理删掉已进回收站的行。旧 schema 里没有 deleted_at，一条被删的
    # 收款方和一条在用的收款方会变成两条无法区分的重复税号，全表唯一约束建不回去。
    # 这是软删除**唯一**一处真正的物理删除，且只在回退时发生。
    op.execute("DELETE FROM wht.payees WHERE deleted_at IS NOT NULL")
    op.execute("DELETE FROM core.exchange_rates WHERE deleted_at IS NOT NULL")
    op.execute("DELETE FROM core.signature_assets WHERE deleted_at IS NOT NULL")

    op.drop_index(
        "uq_core_exchange_rates_currency_date_live",
        table_name="exchange_rates",
        schema="core",
    )
    op.create_unique_constraint(
        "uq_core_exchange_rates_currency_date",
        "exchange_rates",
        ["currency", "rate_date"],
        schema="core",
    )

    op.drop_index("uq_wht_payees_tax_id_live", table_name="payees", schema="wht")
    op.create_unique_constraint(
        "uq_wht_payees_tax_id",
        "payees",
        ["tax_id"],
        schema="wht",
    )

    op.drop_column("exchange_rates", "is_active", schema="core")
    for schema, table in _SOFT_DELETE_TABLES:
        op.drop_column(table, "deleted_by_name", schema=schema)
        op.drop_column(table, "deleted_at", schema=schema)
