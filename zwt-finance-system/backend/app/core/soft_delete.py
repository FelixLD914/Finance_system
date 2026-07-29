"""主数据的软删除（回收站）语义。

**业务单据不用这套东西。** wht.tasks / tax_invoice.invoices / salary_advance.records
都有状态机，作废是 voided 状态而不是删除，删掉一张已签发的税票在制度上就不成立。
这里只服务于「主数据」——没有状态机、只有启停开关的那类参照数据：

  - wht.payees            收款方
  - core.signature_assets 签名图库
  - core.exchange_rates   汇率

回收站是终点，没有「彻底删除」（2026-07-29 业务确认）。财务系统里被单据引用过的
主数据不该从库里消失，删除只是把它移出业务视野。这条决定直接决定了三件事：

  1. 不提供物理 DELETE 端点，也不写定期清理任务；
  2. 外键（如 wht.tasks.payee_id）继续指向已删除行，历史单据的可追溯性不受影响，
     因此软删除**不需要**先解绑引用、也不需要 ON DELETE 处理；
  3. 已删除行仍占着表空间。主数据量级很小（收款方 52 条），这个代价可以忽略。

唯一键怎么处理**逐表不同**，别想当然地统一：
  - wht.payees.tax_id：删除后立刻释放（2026-07-29 业务确认），走部分唯一索引
    `WHERE deleted_at IS NULL`。代价是回收站里那条恢复时可能撞号，此时明确报冲突。
  - core.exchange_rates (currency, rate_date)：同样走部分唯一索引，但理由不是业务
    选择而是正确性——导入用 ON CONFLICT，若沿用全表唯一约束，"删掉错汇率再重导"
    会命中那条已删除行并更新它，行仍是删除状态，导入看着成功界面上却没有。
  - core.signature_assets：两个唯一约束都**原样保留**。storage_key 是 UUID 文件路径，
    删了磁盘文件还在，不该被复用；name+version 的 version 由 max+1 算出，若删除释放
    了版本号，同一个 name+v3 会指向两张不同的图，历史 PDF 就对不上号了。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column


class SoftDeleteMixin:
    """给主数据表加上 deleted_at / deleted_by_name 两列。

    继承它的模型必须自己把「未删除」条件加进查询——SQLAlchemy 没有全局软删除
    过滤器，加一个（如 with_loader_criteria）会让"为什么这行查不到"变成隐式行为。
    这里刻意保持显式：每个 list 方法自己写 `.where(Model.deleted_at.is_(None))`。
    """

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )
    # 删除人单独记，不复用 updated_by_name：恢复之后 updated_by_name 会被恢复人覆盖，
    # 但"当初是谁删的"仍然要能查到。
    deleted_by_name: Mapped[str | None] = mapped_column(String(160), nullable=True, default=None)

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None
