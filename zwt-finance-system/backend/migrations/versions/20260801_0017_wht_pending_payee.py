"""WHT 分步开票：任务上加 payee_pending 标志，标记「收款方还欠主数据一笔」。

业务口径 2026-08-01：批量导入时遇到主数据里没有的收款方，不再整表退回，而是让用户
在前端核对页里手工补全，草稿先带着这份资料落库；**等票据批准时**才把它写进
wht.payees。这样没走到批准的草稿不会污染主数据，而批准是号码落定、单据成为正式凭证
的那一刻，收款方档案在此同时定版，两者时点一致。

为什么不新建一张「待入库收款方」暂存表：wht.tasks 本来就把收款方信息反规范化存了
一份（company_name / company_name_en / payee_address / tax_id / wht_type），恰好覆盖
PayeeProfile 的全部必填列。多一张表就要多一套生命周期（谁清理、草稿删了怎么办），
而一个布尔标志就能表达「这份快照还没进主数据」。aliases 不在任务上，新建的档案别名
留空，事后在收款方主数据里补。

Revision ID: 20260801_0017
Revises: 20260731_0016
Create Date: 2026-08-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260801_0017"
down_revision: str | None = "20260731_0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "wht"
_TABLE = "tasks"


def upgrade() -> None:
    op.add_column(
        _TABLE,
        sa.Column(
            "payee_pending",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        schema=_SCHEMA,
    )


def downgrade() -> None:
    op.drop_column(_TABLE, "payee_pending", schema=_SCHEMA)
