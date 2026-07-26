import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.wht.models import IssueCounter, PayeeProfile, WhtTask, WhtTaskEvent
from app.modules.wht.number_service import assign_number_on_approval
from app.modules.wht.schemas import (
    ImportResult,
    PayeeCreate,
    PayeeUpdate,
    WhtTaskCreate,
    WhtTaskUpdate,
)

MONEY_QUANTUM = Decimal("0.01")


class WhtServiceError(RuntimeError):
    status_code = 400


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
    ) -> tuple[list[PayeeProfile], int]:
        filters = []
        if active_only:
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
        existing = await self.session.scalar(
            select(PayeeProfile).where(PayeeProfile.tax_id == payload.tax_id)
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

    async def import_payees(
        self,
        rows: list[dict[str, Any]],
        source_file_name: str,
    ) -> ImportResult:
        result = ImportResult(source_file_name=source_file_name, created=0)
        for row in rows:
            payee = await self.session.scalar(
                select(PayeeProfile).where(PayeeProfile.tax_id == row["tax_id"]).with_for_update()
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
                select(PayeeProfile.id).where(PayeeProfile.tax_id == values["tax_id"])
            )
            task = WhtTask(
                **values,
                payee_id=payee_id,
                status="issued",
                document_count=1,
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
    ) -> PayeeProfile:
        statement = select(PayeeProfile).where(PayeeProfile.id == payee_id)
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
