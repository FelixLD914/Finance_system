"""Keep every BOT rate type, not just buying transfer

Revision ID: 20260728_0007
Revises: 20260726_0006
Create Date: 2026-07-28

BOT 的 DAILY_AVG_EXG_RATE 每天每币种同时给出 buying_sight / buying_transfer /
selling / mid_rate 四个值，原来只落了 buying_transfer，其余三个抓回来就扔掉。
出口税票按 buying transfer 计价这条业务规则不变，所以 buying_transfer 仍是
NOT NULL；新增三列可空——Excel 导入的行本来就只有 transfer 一个值。
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260728_0007"
down_revision: str | None = "20260726_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RATE_COLUMNS = ("buying_sight", "selling", "mid_rate")


def upgrade() -> None:
    for name in RATE_COLUMNS:
        op.add_column(
            "exchange_rates",
            sa.Column(name, sa.Numeric(18, 6), nullable=True),
            schema="core",
        )
    # 台账页要按币种筛选，(currency, rate_date) 的唯一约束是按 currency 前缀的，
    # 单查某个币种的最近 N 天能用上，这里不再另建索引。


def downgrade() -> None:
    for name in reversed(RATE_COLUMNS):
        op.drop_column("exchange_rates", name, schema="core")
