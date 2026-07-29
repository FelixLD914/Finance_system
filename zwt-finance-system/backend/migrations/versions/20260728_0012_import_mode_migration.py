"""Allow import_mode = 'migration' on tax_invoice.import_batches

Revision ID: 20260728_0012
Revises: 20260728_0011
Create Date: 2026-07-28

原来只有 'dual'（双文件识别）和 'sample'（Sample 表格导入）两种模式，而
「历史迁移」和「常规批量开具」都挤在 sample 里。这两件事的编号口径正好相反：
迁移必须沿用旧系统已经开出的编号，常规批量开票的编号只能由批准时的数据库
事务生成。挤在同一个模式里就没法在后端把后者的编号拦掉，只能靠界面上写一句
提示——而提示拦不住人。

拆出 'migration' 之后，两条路各自有独立端点与独立校验，import_mode 也终于
和实际业务语义对上，审计时能直接看出这一批是迁移还是开票。

不回填历史数据：已有的 sample 批次记录的是当时系统实际执行的路径，
事后改写审计字段等于篡改历史。要区分老批次是不是迁移，看它的税票有没有
带 document_no 即可。
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260728_0012"
down_revision: str | None = "20260728_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "import_batches"
_SCHEMA = "tax_invoice"
# 必须在 upgrade/downgrade 的调用期再套 op.f()：模块导入时 Operations proxy
# 尚未建立，顶层调用会让 `alembic heads/history` 直接 NameError。
_CONSTRAINT = "ck_import_batches_import_mode_allowed"


def upgrade() -> None:
    constraint = op.f(_CONSTRAINT)
    op.drop_constraint(constraint, _TABLE, schema=_SCHEMA, type_="check")
    op.create_check_constraint(
        constraint,
        _TABLE,
        "import_mode IN ('dual', 'sample', 'migration')",
        schema=_SCHEMA,
    )


def downgrade() -> None:
    # 回退前必须先把 migration 批次归回 sample，否则旧约束建不起来。
    # 这些批次的税票本来就带原编号，归到 sample 不丢信息。
    op.execute(
        "UPDATE tax_invoice.import_batches "
        "SET import_mode = 'sample' WHERE import_mode = 'migration'"
    )
    constraint = op.f(_CONSTRAINT)
    op.drop_constraint(constraint, _TABLE, schema=_SCHEMA, type_="check")
    op.create_check_constraint(
        constraint,
        _TABLE,
        "import_mode IN ('dual', 'sample')",
        schema=_SCHEMA,
    )
