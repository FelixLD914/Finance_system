import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ServiceError
from app.modules.wht import income_types
from app.modules.wht.batch_import import resolve_rate as resolve_batch_rate
from app.modules.wht.batch_review import PayeeSnapshot, review_row
from app.modules.wht.branching import normalize_branch
from app.modules.wht.models import IssueCounter, PayeeProfile, WhtTask, WhtTaskEvent
from app.modules.wht.number_service import assign_number_on_approval
from app.modules.wht.schemas import (
    BatchCommitRequest,
    BatchCreateResult,
    BatchPreviewPayee,
    BatchPreviewResponse,
    BatchPreviewRow,
    BatchTransitionItem,
    ImportResult,
    PayeeCreate,
    PayeeUpdate,
    WhtTaskCreate,
    WhtTaskUpdate,
)

MONEY_QUANTUM = Decimal("0.01")


class WhtServiceError(ServiceError):
    """WHT 模块异常基类。真正的基类已提到 app.core.errors.ServiceError，
    这里保留原名以免改动大量既有 import。"""


class WhtNotFoundError(WhtServiceError):
    status_code = 404


class WhtConflictError(WhtServiceError):
    status_code = 409


class WhtStateError(WhtServiceError):
    status_code = 422


@dataclass
class TaskAggregate:
    task: WhtTask
    events: list[WhtTaskEvent]


class WhtService:
    def __init__(self, session: AsyncSession, actor_name: str) -> None:
        self.session = session
        self.actor_name = actor_name

    async def list_tasks(
        self,
        *,
        period: str | None,
        status: str | None,
        book_no: str | None,
        query: str | None,
        page: int,
        page_size: int,
    ) -> tuple[list[WhtTask], int]:
        filters = []
        if period:
            filters.append(WhtTask.period == period)
        if status:
            filters.append(WhtTask.status == status)
        if book_no:
            filters.append(WhtTask.book_no == book_no)
        if query:
            pattern = f"%{query.strip()}%"
            filters.append(
                or_(
                    WhtTask.company_name.ilike(pattern),
                    WhtTask.company_name_en.ilike(pattern),
                    WhtTask.task_no.ilike(pattern),
                    WhtTask.tax_id.ilike(pattern),
                )
            )

        total = await self.session.scalar(select(func.count()).select_from(WhtTask).where(*filters))
        tasks = list(
            (
                await self.session.scalars(
                    select(WhtTask)
                    .where(*filters)
                    .order_by(WhtTask.updated_at.desc(), WhtTask.created_at.desc())
                    .offset((page - 1) * page_size)
                    .limit(page_size)
                )
            ).all()
        )
        return tasks, int(total or 0)

    async def get_task(self, task_id: uuid.UUID) -> TaskAggregate:
        task = await self._load_task(task_id)
        events = list(
            (
                await self.session.scalars(
                    select(WhtTaskEvent)
                    .where(WhtTaskEvent.task_id == task.id)
                    .order_by(WhtTaskEvent.created_at, WhtTaskEvent.id)
                )
            ).all()
        )
        return TaskAggregate(task=task, events=events)

    async def create_task(self, payload: WhtTaskCreate) -> TaskAggregate:
        values = payload.model_dump(by_alias=False)
        payee_id = values.pop("payee_id")
        company_name = values.pop("company_name")
        rate_override_note = values.pop("rate_override_note")
        if payee_id is not None:
            payee = await self._load_payee(payee_id)
            company_name = payee.name_th
            values["company_name_en"] = values["company_name_en"] or payee.name_en
            values["payee_address"] = values["payee_address"] or payee.address_th
            values["tax_id"] = values["tax_id"] or payee.tax_id
            values["wht_type"] = values["wht_type"] or payee.wht_type
            values["branch_type"] = payee.branch_type
            values["branch_number"] = payee.branch_number
        if not company_name:
            raise WhtStateError("companyName is required")
        try:
            values["branch_type"], values["branch_number"] = normalize_branch(
                values["wht_type"],
                values.get("branch_type"),
                values.get("branch_number"),
            )
        except ValueError as exc:
            raise WhtStateError(str(exc)) from exc

        note = self._rate_override_note(
            values["income_type"],
            values["wht_type"],
            values["wht_rate"],
            rate_override_note,
        )

        values["wht_amount"] = self._calculated_wht_amount(
            values["total_amount"],
            values["wht_rate"],
            values["wht_amount"],
        )
        task = WhtTask(
            **values,
            payee_id=payee_id,
            company_name=company_name,
            created_by_name=self.actor_name,
            updated_by_name=self.actor_name,
        )
        self.session.add(task)
        await self.session.flush()
        event = self._event(task, "created", None, "draft", note)
        self.session.add(event)
        await self.session.commit()
        await self.session.refresh(task)
        await self.session.refresh(event)
        return TaskAggregate(task=task, events=[event])

    async def update_task(
        self,
        task_id: uuid.UUID,
        payload: WhtTaskUpdate,
    ) -> TaskAggregate:
        task = await self._load_task(task_id, for_update=True)
        self._check_version(task, payload.version)
        if task.status != "draft":
            raise WhtStateError("only draft tasks can be edited")

        updates = payload.model_dump(
            by_alias=False,
            exclude_unset=True,
            exclude={"version", "rate_override_note"},
        )
        payee_id = updates.pop("payee_id", None)
        if "payee_id" in payload.model_fields_set:
            task.payee_id = payee_id
            if payee_id is not None:
                payee = await self._load_payee(payee_id)
                updates.update(
                    {
                        "company_name": payee.name_th,
                        "company_name_en": payee.name_en,
                        "payee_address": payee.address_th,
                        "tax_id": payee.tax_id,
                        "wht_type": payee.wht_type,
                        "branch_type": payee.branch_type,
                        "branch_number": payee.branch_number,
                    }
                )
        for name, value in updates.items():
            setattr(task, name, value)
        try:
            task.branch_type, task.branch_number = normalize_branch(
                task.wht_type, task.branch_type, task.branch_number
            )
        except ValueError as exc:
            raise WhtStateError(str(exc)) from exc
        if {"total_amount", "wht_rate"}.intersection(payload.model_fields_set) and (
            "wht_amount" not in payload.model_fields_set
        ):
            task.wht_amount = self._calculated_wht_amount(
                task.total_amount,
                task.wht_rate,
                None,
            )
        # 按**改完之后**的值判定，而不是按这次改了哪些字段：把收入类型换成一个法定
        # 税率不同的类型，同样会让原本合规的税率变成偏离。修订已开具的票走的也是
        # 这条路（revise 先退回草稿），所以这一步同时守住了更正链路。
        note = self._rate_override_note(
            task.income_type,
            task.wht_type,
            task.wht_rate,
            payload.rate_override_note,
        )
        task.version += 1
        task.updated_by_name = self.actor_name
        event = self._event(task, "updated", "draft", "draft", note)
        self.session.add(event)
        await self.session.commit()
        await self.session.refresh(task)
        await self.session.refresh(event)
        return TaskAggregate(task=task, events=[event])

    async def submit_for_review(
        self,
        task_id: uuid.UUID,
        version: int,
        note: str | None,
    ) -> TaskAggregate:
        task = await self._load_task(task_id, for_update=True)
        self._check_version(task, version)
        if task.status != "draft":
            raise WhtStateError("only draft tasks can be submitted for review")
        self._validate_ready_for_review(task)
        task.status = "pending_review"
        task.version += 1
        task.updated_by_name = self.actor_name
        event = self._event(task, "submitted_for_review", "draft", task.status, note)
        self.session.add(event)
        await self.session.commit()
        await self.session.refresh(task)
        await self.session.refresh(event)
        return TaskAggregate(task=task, events=[event])

    async def approve(
        self,
        task_id: uuid.UUID,
        version: int,
        note: str | None,
    ) -> TaskAggregate:
        task = await self._load_task(task_id, for_update=True)
        self._check_version(task, version)
        if task.status != "pending_review":
            raise WhtStateError("only pending-review tasks can be approved")
        payee_note = await self._materialize_pending_payee(task)
        await assign_number_on_approval(self.session, task)
        # 修订过的票据带着原票号回到草稿，再批准时 assign_number_on_approval 会在
        # "已有票号"处提前返回（保号是业务口径），于是状态不会被它设成 approved。
        # 状态归属本就该在这里表达，不该藏在取号函数的一条分支里。
        task.status = "approved"
        task.version += 1
        task.approved_at = datetime.now(UTC)
        task.updated_by_name = self.actor_name
        event = self._event(
            task,
            "approved",
            "pending_review",
            "approved",
            "；".join(filter(None, (note, payee_note))) or None,
        )
        self.session.add(event)
        await self.session.commit()
        await self.session.refresh(task)
        await self.session.refresh(event)
        return TaskAggregate(task=task, events=[event])

    async def revise(
        self,
        task_id: uuid.UUID,
        version: int,
        reason: str,
    ) -> TaskAggregate:
        """把已批准/已开具的票据退回草稿以便更正，**票号保持不变**。

        业务口径 2026-08-01：更正走「替换件」而不是「作废重开」——原票号继续有效，
        改完重新批准、重新出具，文件版本号 +1（v1 留档，见 WhtDocument 的
        task_id+file_format+version 唯一约束）。号码不消耗，台账上仍是一条记录。

        权限只要 wht:write：发现打字错误的往往是经办人，而改完要重新走
        submit-review → approve，正式重新出具那一步仍由 wht:approve 把关。
        """
        task = await self._load_task(task_id, for_update=True)
        self._check_version(task, version)
        if task.status not in {"approved", "issued"}:
            raise WhtStateError("only approved or issued tasks can be revised")
        cleaned = reason.strip()
        if not cleaned:
            raise WhtStateError("a revision reason is required")
        previous = task.status
        task.status = "draft"
        task.version += 1
        task.updated_by_name = self.actor_name
        event = self._event(task, "revised", previous, "draft", cleaned)
        self.session.add(event)
        await self.session.commit()
        await self.session.refresh(task)
        await self.session.refresh(event)
        return TaskAggregate(task=task, events=[event])

    async def _materialize_pending_payee(self, task: WhtTask) -> str | None:
        """批准时把人工补录的收款方写进主数据，返回要记进事件的一句话。

        同税号可能在预览之后被别人正常建好了（也可能同一批里有两行是同一个新收款方，
        第一条批准时就建好了），所以先按税号找在用记录：找到就直接挂上去，**不覆盖**
        对方的名称地址——主数据是别人维护的权威副本，一次开票不该顺手改写它。
        """
        if not task.payee_pending:
            return None
        if not task.tax_id or not task.payee_address or not task.wht_type:
            raise WhtStateError(
                "the manually entered payee is incomplete; taxId, address and whtType "
                "are all printed on the certificate"
            )
        existing = await self.session.scalar(
            select(PayeeProfile)
            .where(
                PayeeProfile.tax_id == task.tax_id,
                PayeeProfile.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if existing is not None:
            task.payee_id = existing.id
            task.payee_pending = False
            return f"收款方 {task.tax_id} 已在主数据中，直接关联「{existing.name_th}」"
        payee = PayeeProfile(
            tax_id=task.tax_id,
            name_th=task.company_name,
            name_en=task.company_name_en,
            address_th=task.payee_address,
            wht_type=task.wht_type,
            branch_type=task.branch_type,
            branch_number=task.branch_number,
            # 别名要靠人辨认历史写法，建单时没有依据可填，留空由收款方主数据页补。
            aliases=[],
            is_active=True,
            source_file_name=task.source_file_name,
            created_by_name=self.actor_name,
            updated_by_name=self.actor_name,
        )
        self.session.add(payee)
        await self.session.flush()
        task.payee_id = payee.id
        task.payee_pending = False
        return f"新建收款方主数据「{payee.name_th}」（税号 {payee.tax_id}）"

    async def return_to_draft(
        self,
        task_id: uuid.UUID,
        version: int,
        note: str | None,
    ) -> TaskAggregate:
        task = await self._load_task(task_id, for_update=True)
        self._check_version(task, version)
        if task.status != "pending_review":
            raise WhtStateError("only pending-review tasks can be returned to draft")
        task.status = "draft"
        task.version += 1
        task.updated_by_name = self.actor_name
        event = self._event(
            task,
            "returned_to_draft",
            "pending_review",
            "draft",
            note,
        )
        self.session.add(event)
        await self.session.commit()
        await self.session.refresh(task)
        await self.session.refresh(event)
        return TaskAggregate(task=task, events=[event])

    async def list_payees(
        self,
        query: str | None,
        active_only: bool,
        deleted: bool = False,
    ) -> tuple[list[PayeeProfile], int]:
        """deleted=False 出「在用」列表，deleted=True 出「回收站」。

        两者互斥而不是叠加：回收站是一个独立视图，不是在用列表上的一个筛选项。
        active_only 在回收站视图里没有意义（删除时保留了原来的启停状态，
        回收站按停用与否再切一刀只会让人困惑），因此那边强制忽略它。
        """
        filters = [
            PayeeProfile.deleted_at.is_not(None)
            if deleted
            else PayeeProfile.deleted_at.is_(None)
        ]
        if active_only and not deleted:
            filters.append(PayeeProfile.is_active.is_(True))
        if query:
            pattern = f"%{query.strip()}%"
            filters.append(
                or_(
                    PayeeProfile.tax_id.ilike(pattern),
                    PayeeProfile.name_th.ilike(pattern),
                    PayeeProfile.name_en.ilike(pattern),
                )
            )
        payees = list(
            (
                await self.session.scalars(
                    select(PayeeProfile).where(*filters).order_by(PayeeProfile.name_th)
                )
            ).all()
        )
        return payees, len(payees)

    async def create_payee(self, payload: PayeeCreate) -> PayeeProfile:
        # 只和「未删除」的行比税号。回收站里躺着同税号的记录不该挡住新建——
        # 这正是「删除即释放税号」这条决定的直接体现（2026-07-29 业务确认）。
        existing = await self.session.scalar(
            select(PayeeProfile).where(
                PayeeProfile.tax_id == payload.tax_id,
                PayeeProfile.deleted_at.is_(None),
            )
        )
        if existing is not None:
            raise WhtConflictError("a payee with this taxId already exists")
        payee = PayeeProfile(
            **payload.model_dump(by_alias=False),
            created_by_name=self.actor_name,
            updated_by_name=self.actor_name,
        )
        self.session.add(payee)
        await self.session.commit()
        await self.session.refresh(payee)
        return payee

    async def update_payee(
        self,
        payee_id: uuid.UUID,
        payload: PayeeUpdate,
    ) -> PayeeProfile:
        payee = await self._load_payee(payee_id, for_update=True)
        for name, value in payload.model_dump(by_alias=False, exclude_unset=True).items():
            setattr(payee, name, value)
        try:
            payee.branch_type, payee.branch_number = normalize_branch(
                payee.wht_type, payee.branch_type, payee.branch_number
            )
        except ValueError as exc:
            raise WhtStateError(str(exc)) from exc
        payee.updated_by_name = self.actor_name
        await self.session.commit()
        await self.session.refresh(payee)
        return payee

    async def get_payee(self, payee_id: uuid.UUID) -> PayeeProfile:
        return await self._load_payee(payee_id)

    async def delete_payee(self, payee_id: uuid.UUID) -> PayeeProfile:
        """移入回收站。不动 is_active——恢复时要能还原成删除前的样子。"""
        payee = await self._load_payee(payee_id, for_update=True)
        payee.deleted_at = datetime.now(UTC)
        payee.deleted_by_name = self.actor_name
        await self.session.commit()
        await self.session.refresh(payee)
        return payee

    async def restore_payee(self, payee_id: uuid.UUID) -> PayeeProfile:
        """从回收站恢复。

        税号在删除时就被释放了，所以恢复前必须重新确认它还空着——期间完全可能
        有人用同一个税号建了新记录。撞号时明确报 409 让人自己决定留哪一条，
        绝不自动改税号：税号是有业务含义的真实标识，篡改它等于让数据失真。
        """
        payee = await self._load_payee(payee_id, for_update=True, include_deleted=True)
        if payee.deleted_at is None:
            raise WhtStateError("payee is not in the recycle bin")
        occupied = await self.session.scalar(
            select(PayeeProfile.id).where(
                PayeeProfile.tax_id == payee.tax_id,
                PayeeProfile.deleted_at.is_(None),
            )
        )
        if occupied is not None:
            raise WhtConflictError(
                f"taxId {payee.tax_id} is already used by another payee; "
                f"delete or change that one before restoring this record"
            )
        payee.deleted_at = None
        payee.deleted_by_name = None
        payee.updated_by_name = self.actor_name
        await self.session.commit()
        await self.session.refresh(payee)
        return payee

    async def count_payee_references(self, payee_id: uuid.UUID) -> int:
        """该收款方被多少张 WHT 单据引用。

        软删除不会破坏外键——历史单据的 payee_id 继续指向回收站里的那一行，而且
        单据本身早已把名称/税号/地址反规范化存了一份，所以删除在技术上完全安全。
        这个计数纯粹用于在前端删除确认框里提示影响面，不作为拦截条件。
        """
        return (
            await self.session.scalar(
                select(func.count())
                .select_from(WhtTask)
                .where(WhtTask.payee_id == payee_id)
            )
        ) or 0

    async def import_payees(
        self,
        rows: list[dict[str, Any]],
        source_file_name: str,
    ) -> ImportResult:
        result = ImportResult(source_file_name=source_file_name, created=0)
        for row in rows:
            # 只匹配未删除的行。导入**不会**把回收站里的记录捞回来：那条记录是人
            # 主动删的，一次 Excel 导入不该悄悄推翻这个决定。同税号会新建一条在用
            # 记录，回收站里那条原样留着。
            payee = await self.session.scalar(
                select(PayeeProfile)
                .where(
                    PayeeProfile.tax_id == row["tax_id"],
                    PayeeProfile.deleted_at.is_(None),
                )
                .with_for_update()
            )
            if payee is None:
                try:
                    branch_type, branch_number = normalize_branch(
                        row["wht_type"], row.get("branch_type"), row.get("branch_number")
                    )
                except ValueError as exc:
                    raise WhtStateError(str(exc)) from exc
                profile = {
                    **row,
                    "branch_type": branch_type,
                    "branch_number": branch_number,
                }
                payee = PayeeProfile(
                    **profile,
                    source_file_name=source_file_name,
                    created_by_name=self.actor_name,
                    updated_by_name=self.actor_name,
                )
                self.session.add(payee)
                result.created += 1
            else:
                payee.name_th = row["name_th"]
                payee.address_th = row["address_th"]
                if payee.wht_type != row["wht_type"]:
                    # 旧版 Excel 没有分支列；申报表类型真的发生变化时只能回到该类型
                    # 的安全默认，不能留下 PND3 + head_office 这类自相矛盾组合。
                    payee.branch_type, payee.branch_number = normalize_branch(
                        row["wht_type"], None, None
                    )
                payee.wht_type = row["wht_type"]
                payee.aliases = list(dict.fromkeys([*payee.aliases, *row["aliases"]]))
                payee.is_active = True
                payee.source_file_name = source_file_name
                payee.updated_by_name = self.actor_name
                result.updated += 1
        await self.session.commit()
        return result

    async def import_tasks(
        self,
        rows: list[dict[str, Any]],
        source_file_name: str,
    ) -> ImportResult:
        result = ImportResult(source_file_name=source_file_name, created=0)
        for row in rows:
            values = dict(row)
            sequence = values.pop("sequence")
            duplicate = await self.session.scalar(
                select(WhtTask.id).where(WhtTask.task_no == values["task_no"])
            )
            if duplicate is not None:
                result.skipped += 1
                continue
            if sequence < 1:
                result.errors.append(f"{values['task_no']}: sequence must be positive")
                continue
            payee_id = await self.session.scalar(
                select(PayeeProfile.id).where(
                    PayeeProfile.tax_id == values["tax_id"],
                    PayeeProfile.deleted_at.is_(None),
                )
            )
            task = WhtTask(
                **values,
                payee_id=payee_id,
                status="issued",
                source_file_name=source_file_name,
                created_by_name="历史导入",
                updated_by_name=self.actor_name,
                approved_at=datetime.now(UTC),
                issued_at=datetime.now(UTC),
            )
            self.session.add(task)
            await self.session.flush()
            self.session.add(
                self._event(task, "historical_import", None, "issued", source_file_name)
            )
            await self._seed_counter(task, sequence)
            result.created += 1
        await self.session.commit()
        return result

    async def batch_create_tasks(
        self,
        rows: list[dict[str, Any]],
        source_file_name: str,
    ) -> BatchCreateResult:
        """批量建草稿。全表校验通过才写库，任何一行不合格就整批退回。

        草稿没有正式编号可以去重，"部分成功"会让用户改完重传时把已建的行再建一遍，
        所以这里刻意不做逐行提交：先把收款方、税率全部解析好，最后一次 commit。
        """
        tax_ids = {row["payee_tax_id"] for row in rows}
        payees = {
            payee.tax_id: payee
            for payee in (
                await self.session.scalars(
                    select(PayeeProfile).where(
                        PayeeProfile.tax_id.in_(tax_ids),
                        PayeeProfile.deleted_at.is_(None),
                    )
                )
            ).all()
        }

        errors: list[str] = []
        prepared: list[dict[str, Any]] = []
        for row in rows:
            row_number = row["row_number"]
            payee = payees.get(row["payee_tax_id"])
            if payee is None:
                errors.append(
                    f"row {row_number}: no payee with taxId {row['payee_tax_id']}; "
                    f"add it to the payee master data first"
                )
                continue
            if not payee.is_active:
                errors.append(f"row {row_number}: payee {payee.name_th} is deactivated")
                continue
            wht_rate = resolve_batch_rate(row, payee.wht_type)
            if wht_rate is None:
                errors.append(
                    f"row {row_number}: TaxRate is required because \"{row['income_type']}\" "
                    f"is not in the income-type catalogue for {payee.wht_type}"
                )
                continue
            if row["issuance_type"] == "normal" and row["supplement_run"] != 0:
                errors.append(f"row {row_number}: normal issuance must use SupplementRun 0")
                continue
            # 与单条录入同一条口径：税率偏离法定值必须留痕。批量这里收集错误
            # 而不是抛，好让用户一次看到所有行的问题（全表退回）。
            deviation = self._rate_deviation(row["income_type"], payee.wht_type, wht_rate)
            reason = (row.get("rate_reason") or "").strip() or None
            if deviation is not None and reason is None:
                entered, statutory = deviation
                errors.append(
                    f"row {row_number}: TaxRateReason is required because {entered} "
                    f'deviates from the statutory {statutory} for "{row["income_type"]}" '
                    f"under {payee.wht_type}"
                )
                continue
            prepared.append(
                {
                    "row": row,
                    "payee": payee,
                    "wht_rate": wht_rate,
                    "rate_note": self._stamp_rate_note(deviation, reason),
                }
            )

        if errors:
            raise WhtStateError("; ".join(errors))

        created: list[WhtTask] = []
        for entry in prepared:
            row, payee = entry["row"], entry["payee"]
            task = WhtTask(
                period=row["period"],
                issuance_type=row["issuance_type"],
                supplement_run=row["supplement_run"],
                payee_id=payee.id,
                company_name=payee.name_th,
                company_name_en=payee.name_en,
                payee_address=payee.address_th,
                tax_id=payee.tax_id,
                wht_type=payee.wht_type,
                branch_type=payee.branch_type,
                branch_number=payee.branch_number,
                income_type=row["income_type"],
                payment_date=row["payment_date"],
                wht_rate=entry["wht_rate"],
                total_amount=row["total_amount"],
                wht_amount=self._calculated_wht_amount(
                    row["total_amount"],
                    entry["wht_rate"],
                    None,
                ),
                source_file_name=source_file_name,
                created_by_name=self.actor_name,
                updated_by_name=self.actor_name,
            )
            self.session.add(task)
            created.append(task)
        await self.session.flush()
        # created 与 prepared 一一对应且同序。事件 note 本来就放来源文件名，
        # 有税率理由时接在后面，不覆盖掉文件名——两者事后都要能查。
        for task, entry in zip(created, prepared, strict=True):
            rate_note = entry["rate_note"]
            self.session.add(
                self._event(
                    task,
                    "batch_created",
                    None,
                    "draft",
                    f"{source_file_name}；{rate_note}" if rate_note else source_file_name,
                )
            )
        await self.session.commit()
        return BatchCreateResult(
            source_file_name=source_file_name,
            created=len(created),
            task_ids=[task.id for task in created],
        )

    async def preview_batch_tasks(
        self,
        rows: list[dict[str, Any]],
        source_file_name: str,
    ) -> BatchPreviewResponse:
        """核对用的只读预览：配收款方、带税率、算代扣金额，**一个字都不写库**。

        与一步式 batch_create_tasks 的根本区别：收款方查不到不再是错误，而是一种
        待办状态（payee_missing），交给前端让人补录。也因此这里绝不"有错就整表退回"
        ——整张表都要回给用户看，他才知道要改哪几行。
        """
        payees = await self._payees_by_tax_id({row["payee_tax_id"] for row in rows})
        reviewed = [
            review_row(row, self._payee_snapshot(payees.get(row["payee_tax_id"])))
            for row in rows
        ]
        return BatchPreviewResponse(
            source_file_name=source_file_name,
            rows=[
                BatchPreviewRow(
                    row_number=item.row_number,
                    status=item.status,
                    period=item.period,
                    issuance_type=item.issuance_type,  # type: ignore[arg-type]
                    supplement_run=item.supplement_run,
                    income_type=item.income_type,
                    payment_date=item.payment_date,
                    total_amount=item.total_amount,
                    payee=BatchPreviewPayee(
                        payee_id=item.payee.payee_id,
                        tax_id=item.payee.tax_id,
                        name_th=item.payee.name_th,
                        name_en=item.payee.name_en,
                        address_th=item.payee.address_th,
                        wht_type=item.payee.wht_type,  # type: ignore[arg-type]
                        branch_type=item.payee.branch_type,  # type: ignore[arg-type]
                        branch_number=item.payee.branch_number,
                        is_active=item.payee.is_active,
                    ),
                    wht_rate=item.wht_rate,
                    statutory_rate=item.statutory_rate,
                    wht_amount=item.wht_amount,
                    rate_reason=item.rate_reason,
                    errors=item.errors,
                )
                for item in reviewed
            ],
            ready=sum(1 for item in reviewed if item.status == "ready"),
            payee_missing=sum(1 for item in reviewed if item.status == "payee_missing"),
            needs_input=sum(1 for item in reviewed if item.status == "needs_input"),
        )

    async def commit_batch_tasks(self, payload: BatchCommitRequest) -> BatchCreateResult:
        """把核对完的行落成草稿。仍然是全表校验、有错全退。

        前端已经在核对页拦过一轮，但这里必须原样再校验一遍：预览到提交之间收款方
        可能被人停用或删除，而且直接打 API 的调用方根本没经过那个页面。凡是能影响
        正式凭证的判定（税率是否偏离、收款方是否在用），一律以此处为准。
        """
        linked_ids = {row.payee.payee_id for row in payload.rows if row.payee.payee_id}
        by_id = {
            payee.id: payee
            for payee in (
                await self.session.scalars(
                    select(PayeeProfile).where(
                        PayeeProfile.id.in_(linked_ids),
                        PayeeProfile.deleted_at.is_(None),
                    )
                )
            ).all()
        }
        # 补录的新收款方也要按税号查一遍：预览之后可能已经有人正常建好了，
        # 这时直接挂上去，不要再走"批准时新建"那条路。
        new_tax_ids = {row.payee.tax_id for row in payload.rows if not row.payee.payee_id}
        by_tax_id = await self._payees_by_tax_id(new_tax_ids)

        issues: list[dict[str, object]] = []
        # (行, 命中的收款方或 None, 最终税率, 要盖进事件的税率说明)
        prepared: list[tuple[Any, PayeeProfile | None, Decimal, str | None]] = []

        def reject(row: Any, reason: str, detail: str) -> None:
            issues.append(
                {
                    "rows": [row.row_number],
                    "key": row.payee.tax_id,
                    "reason": reason,
                    "detail": detail,
                }
            )

        for row in payload.rows:
            payee = (
                by_id.get(row.payee.payee_id)
                if row.payee.payee_id
                else by_tax_id.get(row.payee.tax_id)
            )
            if row.payee.payee_id and payee is None:
                reject(row, "payee_missing", "the selected payee no longer exists")
                continue
            if payee is not None and not payee.is_active:
                reject(row, "payee_inactive", f"payee {payee.name_th} is deactivated")
                continue

            wht_type = payee.wht_type if payee is not None else row.payee.wht_type
            wht_rate = row.wht_rate or income_types.default_rate(row.income_type, wht_type)
            if wht_rate is None:
                reject(
                    row,
                    "rate_required",
                    f'"{row.income_type}" is not in the {wht_type} catalogue, '
                    f"so whtRate must be supplied",
                )
                continue
            deviation = self._rate_deviation(row.income_type, wht_type, wht_rate)
            reason = (row.rate_reason or "").strip() or None
            if deviation is not None and reason is None:
                entered, statutory = deviation
                reject(
                    row,
                    "rate_reason_required",
                    f"{entered} deviates from the statutory {statutory} for "
                    f'"{row.income_type}" under {wht_type}',
                )
                continue
            prepared.append((row, payee, wht_rate, self._stamp_rate_note(deviation, reason)))

        if issues:
            raise WhtStateError(
                f"{len(issues)} row(s) need fixing; nothing was imported",
                issues=issues,
            )

        created: list[WhtTask] = []
        for row, payee, wht_rate, _ in prepared:
            # 收款方在库里就以库里的为准：主数据是权威副本，界面上的显示值
            # 不该有机会把它覆盖掉。只有补录的新档案才用前端传来的资料。
            profile = row.payee
            task = WhtTask(
                period=row.period,
                issuance_type=row.issuance_type,
                supplement_run=row.supplement_run,
                payee_id=payee.id if payee is not None else None,
                payee_pending=payee is None,
                company_name=payee.name_th if payee is not None else profile.name_th,
                company_name_en=payee.name_en if payee is not None else profile.name_en,
                payee_address=(
                    payee.address_th if payee is not None else profile.address_th
                ),
                tax_id=payee.tax_id if payee is not None else profile.tax_id,
                wht_type=payee.wht_type if payee is not None else profile.wht_type,
                branch_type=(
                    payee.branch_type if payee is not None else profile.branch_type
                ),
                branch_number=(
                    payee.branch_number if payee is not None else profile.branch_number
                ),
                income_type=row.income_type,
                payment_date=row.payment_date,
                wht_rate=wht_rate,
                total_amount=row.total_amount,
                wht_amount=self._calculated_wht_amount(row.total_amount, wht_rate, None),
                source_file_name=payload.source_file_name,
                created_by_name=self.actor_name,
                updated_by_name=self.actor_name,
            )
            self.session.add(task)
            created.append(task)
        await self.session.flush()
        for task, (_, _, _, rate_note) in zip(created, prepared, strict=True):
            notes = [payload.source_file_name]
            if rate_note:
                notes.append(rate_note)
            if task.payee_pending:
                notes.append(f"收款方 {task.tax_id} 为人工补录，批准时写入主数据")
            self.session.add(
                self._event(task, "batch_created", None, "draft", "；".join(notes))
            )
        await self.session.commit()
        return BatchCreateResult(
            source_file_name=payload.source_file_name,
            created=len(created),
            task_ids=[task.id for task in created],
            payees_pending=sum(1 for task in created if task.payee_pending),
        )

    async def _payees_by_tax_id(self, tax_ids: set[str]) -> dict[str, PayeeProfile]:
        """按税号取在用（未删除）收款方。停用的也要取回来——是否停用由调用方判定，
        这里把它当"查到了"，否则界面会把停用说成"库里没有"，引导人再建一条重号的。"""
        if not tax_ids:
            return {}
        return {
            payee.tax_id: payee
            for payee in (
                await self.session.scalars(
                    select(PayeeProfile).where(
                        PayeeProfile.tax_id.in_(tax_ids),
                        PayeeProfile.deleted_at.is_(None),
                    )
                )
            ).all()
        }

    @staticmethod
    def _payee_snapshot(payee: PayeeProfile | None) -> PayeeSnapshot | None:
        if payee is None:
            return None
        return PayeeSnapshot(
            payee_id=payee.id,
            tax_id=payee.tax_id,
            name_th=payee.name_th,
            name_en=payee.name_en,
            address_th=payee.address_th,
            wht_type=payee.wht_type,
            branch_type=payee.branch_type,
            branch_number=payee.branch_number,
            is_active=payee.is_active,
        )

    async def batch_transition(
        self,
        action: str,
        items: list[tuple[uuid.UUID, int]],
        note: str | None = None,
    ) -> list[BatchTransitionItem]:
        """批量流转。每条独立提交：批准要逐条取编号，一条失败不应回滚已拿到编号的。

        与批量导入相反，这里"部分成功"是正确行为——重跑时已经流转过的那些会因为
        状态校验被拒，不会重复扣号，所以逐条提交没有重复建数据的风险。
        """
        handlers = {
            "submit-review": self.submit_for_review,
            "approve": self.approve,
            "return-to-draft": self.return_to_draft,
        }
        handler = handlers.get(action)
        if handler is None:
            raise WhtStateError(f"unsupported batch action: {action}")

        results: list[BatchTransitionItem] = []
        for task_id, version in items:
            try:
                aggregate = await handler(task_id, version, note)
            except WhtServiceError as exc:
                await self.session.rollback()
                results.append(
                    BatchTransitionItem(task_id=task_id, succeeded=False, error=str(exc))
                )
                continue
            results.append(
                BatchTransitionItem(
                    task_id=task_id,
                    succeeded=True,
                    task_no=aggregate.task.task_no,
                )
            )
        return results

    async def _load_task(
        self,
        task_id: uuid.UUID,
        *,
        for_update: bool = False,
    ) -> WhtTask:
        statement = select(WhtTask).where(WhtTask.id == task_id)
        if for_update:
            statement = statement.with_for_update()
        task = await self.session.scalar(statement)
        if task is None:
            raise WhtNotFoundError("WHT task was not found")
        return task

    async def _load_payee(
        self,
        payee_id: uuid.UUID,
        *,
        for_update: bool = False,
        include_deleted: bool = False,
    ) -> PayeeProfile:
        statement = select(PayeeProfile).where(PayeeProfile.id == payee_id)
        if not include_deleted:
            # 默认看不到回收站里的行：建单、改单引用一个已删除的收款方应当是 404，
            # 而不是悄悄带出一份已经被移出业务视野的资料。
            statement = statement.where(PayeeProfile.deleted_at.is_(None))
        if for_update:
            statement = statement.with_for_update()
        payee = await self.session.scalar(statement)
        if payee is None:
            raise WhtNotFoundError("payee was not found")
        return payee

    def _check_version(self, task: WhtTask, expected: int) -> None:
        if task.version != expected:
            raise WhtConflictError("the task was changed by another user; reload before continuing")

    def _validate_ready_for_review(self, task: WhtTask) -> None:
        required = {
            "taxId": task.tax_id,
            "whtType": task.wht_type,
            "incomeType": task.income_type,
            "paymentDate": task.payment_date,
            "whtRate": task.wht_rate,
        }
        missing = [name for name, value in required.items() if value in (None, "")]
        if task.total_amount <= 0:
            missing.append("totalAmount")
        if missing:
            raise WhtStateError(f"task is incomplete; required fields: {', '.join(missing)}")

    @staticmethod
    def _rate_deviation(
        income_type: str | None,
        wht_type: str | None,
        wht_rate: Decimal | None,
    ) -> tuple[str, str] | None:
        """偏离目录法定税率时返回 (实际, 法定) 的百分比文本，没偏离则 None。

        「什么算偏离」只在这里定义一次，单条录入和批量导入共用同一判定，
        免得两条路各写一份、口径慢慢漂开。目录里查不到这个收入类型
        （自由输入的类型）时无从比对，一律算不偏离。
        """
        if income_type is None or wht_rate is None:
            return None
        statutory = income_types.default_rate(income_type, wht_type)
        if statutory is None or statutory == wht_rate:
            return None
        return f"{wht_rate * 100:.2f}%", f"{statutory * 100:.2f}%"

    @staticmethod
    def _stamp_rate_note(deviation: tuple[str, str] | None, note: str | None) -> str | None:
        """把实际税率与法定税率盖在理由前面。

        事后审计只看事件 note，只留一句「合同约定 5%」是看不出法定值是多少的，
        所以两个税率都要写进去。
        """
        if deviation is None:
            return note
        entered, statutory = deviation
        return f"税率 {entered}（法定 {statutory}）：{note}"

    @staticmethod
    def _rate_override_note(
        income_type: str | None,
        wht_type: str | None,
        wht_rate: Decimal | None,
        supplied_note: str | None,
    ) -> str | None:
        """单条录入路径：税率偏离目录法定值时要求填理由，返回事件 note。

        偏离与否由服务端按目录自己判定 —— 前端的警示只是提醒，直接打 API 的
        调用方绕不过去。没偏离时理由若有仍然记下。
        """
        note = (supplied_note or "").strip() or None
        deviation = WhtService._rate_deviation(income_type, wht_type, wht_rate)
        if deviation is None:
            return note
        if note is None:
            entered, statutory = deviation
            raise WhtStateError(
                f"rateOverrideNote is required: {entered} deviates from the "
                f'statutory {statutory} for "{income_type}" under {wht_type}'
            )
        return WhtService._stamp_rate_note(deviation, note)

    @staticmethod
    def _calculated_wht_amount(
        total_amount: Decimal,
        wht_rate: Decimal | None,
        supplied: Decimal | None,
    ) -> Decimal:
        if supplied is not None:
            return supplied.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)
        if wht_rate is None:
            return Decimal("0.00")
        return (total_amount * wht_rate).quantize(
            MONEY_QUANTUM,
            rounding=ROUND_HALF_UP,
        )

    def _event(
        self,
        task: WhtTask,
        event_type: str,
        from_status: str | None,
        to_status: str,
        note: str | None = None,
    ) -> WhtTaskEvent:
        return WhtTaskEvent(
            task_id=task.id,
            event_type=event_type,
            from_status=from_status,
            to_status=to_status,
            actor_name=self.actor_name,
            note=note,
        )

    async def _seed_counter(self, task: WhtTask, sequence: int) -> None:
        statement = insert(IssueCounter).values(
            period=task.period,
            issue_type=task.issuance_type,
            supplement_run=task.supplement_run,
            next_sequence=sequence + 1,
        )
        statement = statement.on_conflict_do_update(
            constraint="uq_wht_issue_counter_scope",
            set_={
                "next_sequence": func.greatest(
                    IssueCounter.next_sequence,
                    statement.excluded.next_sequence,
                ),
                "updated_at": func.now(),
            },
        )
        await self.session.execute(statement)
