from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.core.models import ExchangeRate, SignatureAsset
from app.modules.salary_advance.models import SalaryAdvanceEmployee
from app.modules.tax_invoice.schemas import ExchangeRateUpsert, month_bounds
from app.modules.wht.models import PayeeProfile


@pytest.mark.parametrize(
    "model",
    [PayeeProfile, SignatureAsset, ExchangeRate, SalaryAdvanceEmployee],
)
def test_master_data_models_expose_soft_delete_audit_columns(model) -> None:  # noqa: ANN001
    columns = model.__table__.columns

    assert "deleted_at" in columns
    assert "deleted_by_name" in columns


def test_payee_tax_id_is_unique_only_for_live_rows() -> None:
    index = next(
        item
        for item in PayeeProfile.__table__.indexes
        if item.name == "uq_wht_payees_tax_id_live"
    )

    assert index.unique
    assert str(index.dialect_options["postgresql"]["where"]) == "deleted_at IS NULL"


def test_employee_emp_id_is_unique_only_for_live_rows() -> None:
    index = next(
        item
        for item in SalaryAdvanceEmployee.__table__.indexes
        if item.name == "uq_salary_advance_employees_emp_id_live"
    )

    assert index.unique
    assert str(index.dialect_options["postgresql"]["where"]) == "deleted_at IS NULL"


def test_exchange_rate_identity_is_unique_only_for_live_rows() -> None:
    index = next(
        item
        for item in ExchangeRate.__table__.indexes
        if item.name == "uq_core_exchange_rates_currency_date_live"
    )

    assert index.unique
    assert [column.name for column in index.columns] == ["currency", "rate_date"]
    assert str(index.dialect_options["postgresql"]["where"]) == "deleted_at IS NULL"
    assert ExchangeRate.__table__.columns.is_active.default.arg is True


def test_month_bounds_handles_leap_year_and_year_end() -> None:
    assert month_bounds("2028-02") == (date(2028, 2, 1), date(2028, 2, 29))
    assert month_bounds("2026-12") == (date(2026, 12, 1), date(2026, 12, 31))


@pytest.mark.parametrize("value", ["2026-2", "2026-13", "not-a-month"])
def test_month_bounds_rejects_non_canonical_values(value: str) -> None:
    with pytest.raises(ValueError, match="YYYY-MM"):
        month_bounds(value)


def test_manual_exchange_rate_normalizes_currency_and_rejects_zero() -> None:
    payload = ExchangeRateUpsert(
        currency="usd",
        rate_date=date(2026, 7, 29),
        buying_transfer=Decimal("32.123456"),
    )

    assert payload.currency == "USD"
    with pytest.raises(ValidationError):
        ExchangeRateUpsert(
            currency="USD",
            rate_date=date(2026, 7, 29),
            buying_transfer=Decimal("0"),
        )
