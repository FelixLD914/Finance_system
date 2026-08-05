from __future__ import annotations

import asyncio
import uuid
from datetime import date
from decimal import Decimal

import pytest

from app.core.config import get_settings
from app.modules.salary_advance.models import SalaryAdvanceEmployee
from app.modules.salary_advance.schemas import SingleSalaryAdvanceCreate
from app.modules.salary_advance.service import (
    SalaryAdvanceNotFoundError,
    SalaryAdvanceService,
    SalaryAdvanceStateError,
)
from tests.test_salary_advance_employees import FakeSession


def test_create_single_record_success() -> None:
    fake_session = FakeSession()
    service = SalaryAdvanceService(
        session=fake_session, actor_name="TestAdmin", settings=get_settings()
    )

    employee = SalaryAdvanceEmployee(
        id=uuid.uuid4(),
        emp_id="EMP100",
        first_name="Somchai",
        surname="Saelim",
        en_name="Somchai Saelim",
        chinese_name="宋柴",
        department="Engineering",
        position="Senior Developer",
        start_date=date(2023, 1, 15),
        is_active=True,
        created_by_name="Admin",
        updated_by_name="Admin",
    )
    fake_session.seed(employee)

    payload = SingleSalaryAdvanceCreate(
        emp_id="EMP100",
        period="202608",
        advance_amount=Decimal("15000.00"),
        monthly_deduction=Decimal("3000.00"),
        reason="Medical Expenses / 医疗开支",
        request_date=date(2026, 8, 1),
        approval_status="Approve",
        remark="Single slip test",
    )

    aggregate = asyncio.run(service.create_single_record(payload))

    assert aggregate.batch is not None
    assert aggregate.batch.period == "202608"
    assert aggregate.batch.status == "ready"
    assert aggregate.batch.total_rows == 1
    assert "单张开具 - EMP100" in aggregate.batch.source_file_name

    assert len(aggregate.records) == 1
    rec = aggregate.records[0]
    assert rec.emp_id == "EMP100"
    assert rec.validation_status == "valid"
    assert rec.normalized_data["en_name"] == "SOMCHAI SAELIM"
    assert rec.normalized_data["department"] == "Engineering"
    assert rec.normalized_data["position"] == "Senior Developer"
    assert rec.normalized_data["start_date"] == "2023-01-15"
    assert rec.normalized_data["request_date"] == "2026-08-01"
    assert rec.normalized_data["advance_amount"] == "15000.00"
    assert rec.normalized_data["monthly_deduction"] == "3000.00"
    assert rec.normalized_data["reason"] == "Medical Expenses / 医疗开支"


def test_create_single_record_employee_not_found() -> None:
    fake_session = FakeSession()
    service = SalaryAdvanceService(
        session=fake_session, actor_name="TestAdmin", settings=get_settings()
    )

    payload = SingleSalaryAdvanceCreate(
        emp_id="NON_EXISTENT",
        period="202608",
        advance_amount=Decimal("5000.00"),
        request_date=date(2026, 8, 1),
    )

    with pytest.raises(SalaryAdvanceNotFoundError, match="NON_EXISTENT"):
        asyncio.run(service.create_single_record(payload))


def test_create_single_record_chronology_error_raises_state_error() -> None:
    fake_session = FakeSession()
    service = SalaryAdvanceService(
        session=fake_session, actor_name="TestAdmin", settings=get_settings()
    )

    employee = SalaryAdvanceEmployee(
        id=uuid.uuid4(),
        emp_id="EMP101",
        en_name="Alice",
        department="HR",
        position="Manager",
        start_date=date(2026, 9, 1),  # start_date > request_date
        is_active=True,
        created_by_name="Admin",
        updated_by_name="Admin",
    )
    fake_session.seed(employee)

    payload = SingleSalaryAdvanceCreate(
        emp_id="EMP101",
        period="202608",
        advance_amount=Decimal("5000.00"),
        request_date=date(2026, 8, 1),
    )

    with pytest.raises(SalaryAdvanceStateError, match="入职日期不能晚于申请日期"):
        asyncio.run(service.create_single_record(payload))
