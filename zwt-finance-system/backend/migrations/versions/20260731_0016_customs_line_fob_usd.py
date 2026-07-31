"""发票行加一列 customs_fob_usd：报关单该行自印的 FOB USD。

业务口径 2026-07-31：复核台逐行核对要把「发票每行 FOB USD」和「报关单每行
FOB USD」并排看。报关单行级 USD 一直在识别时算出来做核对，但只用来定 needs_review
就丢了（非落库）。这里把它落到 invoice_items 上，复核台才能逐行展示、标红。

不参与计价——计价汇率仍取 BOT 表。可空：存量行没有这个值，回填靠重新识别，
给默认值只会用 0.00 骗过对账的人。

Revision ID: 20260731_0016
Revises: 20260730_0015
Create Date: 2026-07-31
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260731_0016"
down_revision: str | None = "20260730_0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "tax_invoice"
_TABLE = "invoice_items"
_COLUMN = "customs_fob_usd"


def upgrade() -> None:
    op.add_column(
        _TABLE,
        sa.Column(_COLUMN, sa.Numeric(precision=20, scale=2), nullable=True),
        schema=_SCHEMA,
    )


def downgrade() -> None:
    op.drop_column(_TABLE, _COLUMN, schema=_SCHEMA)
