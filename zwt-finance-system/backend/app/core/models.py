import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.soft_delete import SoftDeleteMixin


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("username", name="uq_core_users_username"),
        {"schema": "core"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(80), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    role: Mapped[str] = mapped_column(String(40), nullable=False, default="operator")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class UserSession(Base):
    """服务端会话。浏览器只持有 HttpOnly Cookie 里的原始令牌。

    表里存的是令牌的 SHA-256 摘要（见 core.security），不是原值。删除一行即刻
    吊销该会话，这正是相对 JWT 选服务端会话的主要理由。
    """

    __tablename__ = "sessions"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_core_sessions_token_hash"),
        Index("ix_core_sessions_user", "user_id"),
        Index("ix_core_sessions_expires_at", "expires_at"),
        {"schema": "core"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("core.users.id", name="fk_sessions_user_id_users", ondelete="CASCADE"),
        nullable=False,
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # 滑动过期：每次请求把 expires_at 往后推，但绝不超过 absolute_expires_at，
    # 这样长期挂着的会话也有硬性上限。
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    absolute_expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class SignatureAsset(Base, SoftDeleteMixin):
    __tablename__ = "signature_assets"
    # 两个唯一约束都保持「全表」语义，不改成部分索引：删除不释放 storage_key
    # （磁盘文件还在）也不释放版本号（否则 name+v3 会指向两张不同的图，
    # 历史 PDF 就对不上号）。理由详见 app.core.soft_delete 的模块注释。
    __table_args__ = (
        UniqueConstraint("storage_key", name="uq_core_signature_assets_storage_key"),
        UniqueConstraint("name", "version", name="uq_core_signature_assets_name_version"),
        {"schema": "core"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    original_file_name: Mapped[str] = mapped_column(String(260), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    # 这张签名能盖在哪些单据上：wht / tax_inv / salary_advance 的逗号分隔集合。
    # 各模块在旧工具里用的是不同的人，所以适用范围必须显式记录。
    # 解析与序列化一律走 app.core.signature_usage，别在别处 split 这个串。
    usage: Mapped[str] = mapped_column(String(60), nullable=False, default="wht")
    # 签名人姓名。**只有工资预支单会印它**——表单在签名横线下方印 "( 姓名 )"，
    # WHT 与 TAX INV 的单据上只有签名图、不出现姓名。所以这一列整体可空，
    # 但适用范围勾了工资预支时必填（校验在 signature_usage.requires_signer_name
    # 与 WhtDocumentService 的建/改两个入口）。
    #
    # 姓名挂在签名资产上而不是每张单据的导入行上，是为了让"印的名字"和"盖的章"
    # 同源：以前姓名来自导入表、章来自签名解析链，两者可以是不同的人且系统拦不住。
    signer_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    # 默认签名是"按适用范围"的：WHT 的默认和 TAX INV 的默认可以是两张不同的图。
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 签名套印缩放比例 (%)，范围 50..200，默认 100
    scale_percent: Mapped[int] = mapped_column(Integer, nullable=False, default=100, server_default="100")
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("core.users.id", name="fk_signature_assets_created_by_users"),
        nullable=True,
    )
    created_by_name: Mapped[str] = mapped_column(String(160), nullable=False)
    updated_by_name: Mapped[str] = mapped_column(String(160), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class ExchangeRate(Base, SoftDeleteMixin):
    __tablename__ = "exchange_rates"
    __table_args__ = (
        # 部分唯一索引。这里换掉表级约束不是为了对齐收款方的策略，是正确性要求：
        # 导入走 ON CONFLICT，若沿用全表唯一约束，「删掉一条错汇率 → 重新从 BOT
        # 导入」会命中那条已删除行并更新它，行仍然是删除状态，导入报成功但界面
        # 上什么都没有。改成部分索引后，重导会正常插入一条新的生效行。
        #
        # 改动连带项：tax_invoice.service.import_exchange_rates 的 on_conflict_do_update
        # 不能再按约束名指定冲突目标（部分索引不是约束，PG 不允许），必须改用
        # index_elements + index_where。
        Index(
            "uq_core_exchange_rates_currency_date_live",
            "currency",
            "rate_date",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        {"schema": "core"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    rate_date: Mapped[date] = mapped_column(Date, nullable=False)
    # 停用：汇率此前没有启停开关，只能靠删。停用保留数据但不再供税票选用，
    # 语义与收款方、签名图库一致（停用=不可选，删除=移出列表）。
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    # 出口税票一律按 buying transfer 计价，所以它是必填；其余三种是 BOT 同一条
    # 记录里顺带给出的，留档备查，Excel 导入的行拿不到就是 NULL。
    buying_transfer: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    buying_sight: Mapped[Decimal | None] = mapped_column(Numeric(18, 6), nullable=True)
    selling: Mapped[Decimal | None] = mapped_column(Numeric(18, 6), nullable=True)
    mid_rate: Mapped[Decimal | None] = mapped_column(Numeric(18, 6), nullable=True)
    source: Mapped[str] = mapped_column(String(40), nullable=False)
    source_file_name: Mapped[str | None] = mapped_column(String(260), nullable=True)
    updated_by_name: Mapped[str] = mapped_column(String(160), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
