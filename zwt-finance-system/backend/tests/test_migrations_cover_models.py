"""迁移必须覆盖模型上的每一列。

这个仓库的单元测试不连数据库（见 conftest 的说明），于是"模型加了列、忘了写
迁移"这一类改动在测试里完全隐形：pytest 全绿，生产上一调用就 UndefinedColumn
500。同一个 bug 已经复发过两次——signature_assets.scale_percent（0019 补救）、
generation_jobs 的两个签名列（0021 补救）。

这里不需要 Postgres：alembic 的离线模式（--sql）会把整条迁移链渲染成 DDL 文本，
从中还原出"升到 head 之后每张表有哪些列"，再和 Base.metadata 对账。
渲染用的 URL 只决定方言，不会建立任何连接。

覆盖不到的：类型、可空性、默认值、约束的差异。那些要真库比对（alembic
autogenerate）才查得出来。这里只钉死"列存不存在"——恰好就是反复出事的那一类。
"""

from __future__ import annotations

import io
import re
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

# 这四个 models 导入是有副作用的：导入即注册到 Base.metadata。
# 清单必须和 migrations/env.py 一致，少一个就等于少校验一个模块。
from app.core import models as _core_models  # noqa: F401
from app.core.database import Base
from app.modules.salary_advance import models as _salary_advance_models  # noqa: F401
from app.modules.tax_invoice import models as _tax_invoice_models  # noqa: F401
from app.modules.wht import models as _wht_models  # noqa: F401

MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"

# CREATE TABLE 的括号内，这些开头的项是约束不是列。
_CONSTRAINT_KEYWORDS = frozenset(
    {"constraint", "primary", "unique", "check", "foreign", "exclude", "like"}
)


def _qualify(raw: str) -> str:
    """把 DDL 里的表名规范成 schema.table；alembic_version 这种无 schema 的算 public。"""
    name = raw.strip().strip(";").replace('"', "").lower()
    return name if "." in name else f"public.{name}"


def _split_top_level(body: str) -> list[str]:
    """按括号深度为 0 的逗号切分——NUMERIC(18, 6) 里的逗号不能算数。"""
    parts: list[str] = []
    depth = 0
    current: list[str] = []
    for char in body:
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        if char == "," and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(char)
    parts.append("".join(current))
    return [part.strip() for part in parts if part.strip()]


def _render_head_sql() -> str:
    """离线渲染 base -> head 的全部 DDL。不连库。"""
    buffer = io.StringIO()
    # 离线渲染写的是 output_buffer 而不是 stdout；只传 stdout 会拿到空串，
    # 而空串会让下面的对账"什么都没解析到"从而全体假绿。两个都给。
    config = Config(output_buffer=buffer, stdout=buffer)
    # 用编程方式构造 Config（不传 alembic.ini）：env.py 只在 config_file_name
    # 非空时调 fileConfig，绕开它就不会改动 pytest 的日志配置。
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    command.upgrade(config, "base:head", sql=True)
    return buffer.getvalue()


def _columns_after_head(sql: str) -> dict[str, set[str]]:
    """回放渲染出来的 DDL，得到升到 head 之后每张表的列集合。"""
    tables: dict[str, set[str]] = {}
    # 先摘掉 alembic 在每条 revision 前插的 "-- Running upgrade X -> Y" 注释行。
    # 不摘的话按 ';' 切分时这行会粘在下一条语句开头，让 ^CREATE/^ALTER 匹配不上，
    # 于是每条 revision 的第一条语句被静默丢掉——这个 bug 只会让测试变松，很难发现。
    # 只删整行以 -- 开头的，不做全局正则：避免动到字符串字面量里的内容。
    body = "\n".join(
        line for line in sql.splitlines() if not line.lstrip().startswith("--")
    )
    statements = [item.strip() for item in body.split(";") if item.strip()]

    create = re.compile(r"^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w.\"]+)\s*\(",
                        re.IGNORECASE | re.DOTALL)
    drop_table = re.compile(r"^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w.\"]+)",
                            re.IGNORECASE)
    alter = re.compile(r"^ALTER\s+TABLE\s+(?:ONLY\s+)?([\w.\"]+)\s+(.*)$",
                       re.IGNORECASE | re.DOTALL)
    add_col = re.compile(r"^ADD\s+COLUMN\s+([\w\"]+)", re.IGNORECASE)
    drop_col = re.compile(r"^DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([\w\"]+)",
                          re.IGNORECASE)
    rename_col = re.compile(r"^RENAME\s+COLUMN\s+([\w\"]+)\s+TO\s+([\w\"]+)",
                            re.IGNORECASE)

    for statement in statements:
        matched = create.match(statement)
        if matched:
            table = _qualify(matched.group(1))
            body = statement[matched.end() : statement.rindex(")")]
            columns = set()
            for item in _split_top_level(body):
                head = item.split(None, 1)[0].replace('"', "").lower()
                if head in _CONSTRAINT_KEYWORDS:
                    continue
                columns.add(head)
            tables[table] = columns
            continue

        matched = drop_table.match(statement)
        if matched:
            tables.pop(_qualify(matched.group(1)), None)
            continue

        matched = alter.match(statement)
        if not matched:
            continue
        table = _qualify(matched.group(1))
        action = matched.group(2).strip()
        columns = tables.setdefault(table, set())
        if sub := add_col.match(action):
            columns.add(sub.group(1).replace('"', "").lower())
        elif sub := drop_col.match(action):
            columns.discard(sub.group(1).replace('"', "").lower())
        elif sub := rename_col.match(action):
            columns.discard(sub.group(1).replace('"', "").lower())
            columns.add(sub.group(2).replace('"', "").lower())

    return tables


@pytest.fixture(scope="module")
def migrated_columns() -> dict[str, set[str]]:
    return _columns_after_head(_render_head_sql())


def test_offline_render_reaches_head(migrated_columns: dict[str, set[str]]) -> None:
    """先确认渲染本身有效——否则下面的对账会因为"什么都没解析到"而假绿。"""
    assert migrated_columns, "离线渲染没有产出任何建表语句"
    assert "salary_advance.generation_jobs" in migrated_columns


@pytest.mark.parametrize(
    "table",
    sorted(Base.metadata.tables.values(), key=lambda t: (t.schema or "", t.name)),
    ids=lambda t: f"{t.schema or 'public'}.{t.name}",
)
def test_every_model_column_exists_in_migrations(
    table: object,
    migrated_columns: dict[str, set[str]],
) -> None:
    key = f"{table.schema or 'public'}.{table.name}"
    assert key in migrated_columns, (
        f"模型里有表 {key}，但迁移链升到 head 之后并不存在这张表。\n"
        "改了 models.py 就要配套写迁移：alembic revision -m ..."
    )
    expected = {column.name.lower() for column in table.columns}
    missing = sorted(expected - migrated_columns[key])
    assert not missing, (
        f"{key} 上的这些列只存在于 models.py，迁移里没有：{missing}\n"
        "生产库升到 head 后不会有这些列，任何读写它们的语句都会 UndefinedColumn。\n"
        "补一条 alembic 迁移，不要改模型来绕过。"
    )
