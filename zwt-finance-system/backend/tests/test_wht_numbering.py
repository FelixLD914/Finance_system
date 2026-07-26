import pytest

from app.modules.wht.numbering import build_normal_number, build_supplement_number


def test_normal_number_and_book() -> None:
    number = build_normal_number("2026-06", 1)

    assert number.task_no == "ZWT202606001"
    assert number.book_no == "202606"


def test_first_supplement_number_and_book() -> None:
    number = build_supplement_number("2026-06", supplement_run=1, sequence=1)

    assert number.task_no == "ZWT202606BK101"
    assert number.book_no == "2606BK1"


def test_second_supplement_book() -> None:
    number = build_supplement_number("2026-06", supplement_run=2, sequence=1)

    assert number.task_no == "ZWT202606BK201"
    assert number.book_no == "2606BK2"


@pytest.mark.parametrize("period", ["2026-00", "2026-13", "202606", "26-06"])
def test_rejects_invalid_period(period: str) -> None:
    with pytest.raises(ValueError):
        build_normal_number(period, 1)


def test_rejects_out_of_range_sequences() -> None:
    with pytest.raises(ValueError):
        build_normal_number("2026-06", 1000)
    with pytest.raises(ValueError):
        build_supplement_number("2026-06", 1, 100)


def test_number_preview_uses_camel_case_api_fields(admin_client) -> None:  # noqa: ANN001
    response = admin_client.get(
        "/api/v1/wht/number-preview",
        params={"period": "2026-06", "issueType": "supplement", "supplementRun": 1},
    )

    assert response.status_code == 200
    assert response.json()["taskNo"] == "ZWT202606BK101"
    assert response.json()["bookNo"] == "2606BK1"
