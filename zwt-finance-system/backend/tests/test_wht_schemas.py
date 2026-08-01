import pytest
from pydantic import ValidationError

from app.modules.wht.schemas import BatchCommitPayee, PayeeCreate, WhtTaskCreate


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


def test_company_payee_defaults_to_head_office() -> None:
    payee = PayeeCreate(
        tax_id="0105540057561",
        name_th="บริษัท ตัวอย่าง จำกัด",
        address_th="กรุงเทพมหานคร",
        wht_type="PND53",
    )

    assert payee.branch_type == "head_office"
    assert payee.branch_number is None


def test_company_branch_requires_a_five_digit_number() -> None:
    with pytest.raises(ValidationError, match="exactly 5 digits"):
        PayeeCreate(
            tax_id="0105540057561",
            name_th="บริษัท ตัวอย่าง จำกัด",
            address_th="กรุงเทพมหานคร",
            wht_type="PND53",
            branch_type="branch",
            branch_number="12",
        )


def test_individual_payee_rejects_company_branch_details() -> None:
    with pytest.raises(ValidationError, match="only available for PND53"):
        PayeeCreate(
            tax_id="3200600843133",
            name_th="น.ส. ฉวี อินเต๋",
            address_th="กรุงเทพมหานคร",
            wht_type="PND3",
            branch_type="head_office",
        )


def test_batch_pending_payee_keeps_branch_snapshot() -> None:
    payee = BatchCommitPayee(
        tax_id="0105540057561",
        name_th="บริษัท ตัวอย่าง จำกัด",
        address_th="กรุงเทพมหานคร",
        wht_type="PND53",
        branch_type="branch",
        branch_number="00001",
    )

    assert payee.branch_type == "branch"
    assert payee.branch_number == "00001"
