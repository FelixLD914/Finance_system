import pytest
from pydantic import ValidationError

from app.modules.wht.schemas import WhtTaskCreate


def test_supplement_requires_run_number() -> None:
    with pytest.raises(ValidationError, match="supplementRun"):
        WhtTaskCreate(
            period="2026-06",
            issuance_type="supplement",
            company_name="บริษัท ตัวอย่าง จำกัด",
        )


def test_normal_rejects_supplement_run() -> None:
    with pytest.raises(ValidationError, match="supplementRun 0"):
        WhtTaskCreate(
            period="2026-06",
            issuance_type="normal",
            supplement_run=1,
            company_name="บริษัท ตัวอย่าง จำกัด",
        )
