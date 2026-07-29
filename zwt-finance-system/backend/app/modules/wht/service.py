import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ServiceError
from app.modules.wht.batch_import import resolve_rate as resolve_batch_rate
from app.modules.wht.models import IssueCounter, PayeeProfile, WhtTask, WhtTaskEvent
from app.modules.wht.number_service import assign_number_on_approval
from app.modules.wht.schemas import (
    BatchCreateResult,
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
        if payee_id is not None:
            payee = await self._load_payee(payee_id)
            company_name = payee.name_th
            values["company_name_en"] = values["company_name_en"] or payee.name_en
            values["payee_address"] = values["payee_address"] or payee.address_th
            values["tax_id"] = values["tax_id"] or payee.tax_id
            values["wht_type"] = values["wht_type"] or payee.wht_type
        if not company_name:
            raise WhtStateError("companyName is required")

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
        event = self._event(task, "created", None, "draft")
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
            exclude={"version"},
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
                    }
                )
        for name, value in updates.items():
            setattr(task, name, value)
        if {"total_amount", "wht_rate"}.intersection(payload.model_fields_set) and (
            "wht_amount" not in payload.model_fields_set
        ):
            task.wht_amount = self._calculated_wht_amount(
                task.total_amount,
                task.wht_rate,
                None,
            )
        task.version += 1
        task.updated_by_name = self.actor_name
        event = self._event(task, "updated", "draft", "draft")
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
        await assign_number_on_approval(self.session, task)
        task.version += 1
        task.approved_at = datetime.now(UTC)
        task.updated_by_name = self.actor_name
        event = self._event(
            task,
            "approved",
            "pending_review",
            "approved",
            note,
        )
        self.session.add(event)
        await self.session.commit()
        await self.session.refresh(task)
        await self.session.refresh(event)
        return TaskAggregate(task=task, events=[event])

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
                payee = PayeeProfile(
                    **row,
                    source_file_name=source_file_name,
                    created_by_name=self.actor_name,
                    updated_by_name=self.actor_name,
                )
                self.session.add(payee)
                result.created += 1
            else:
                payee.name_th = row["name_th"]
                payee.address_th = row["address_th"]
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
            prepared.append({"row": row, "payee": payee, "wht_rate": wht_rate})

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
        for task in created:
            self.session.add(self._event(task, "batch_created", None, "draft", source_file_name))
        await self.session.commit()
        return BatchCreateResult(
            source_file_name=source_file_name,
            created=len(created),
            task_ids=[task.id for task in created],
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
