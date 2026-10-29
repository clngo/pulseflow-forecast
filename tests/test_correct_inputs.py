from __future__ import annotations

import csv

import pytest

from pipeline.process_data import build_outputs, calculate_top8_probability, probability_from_gpa
from tests.fixture_factory import find_audit, make_scenario_dataset


def deal_by_id(forecast: dict, record_id: str) -> dict:
    return next(deal for deal in forecast["deals"] if deal["opportunity_id"] == record_id)


def test_t01_valid_complete_input_returns_exact_forecast(tmp_path) -> None:
    root = make_scenario_dataset(tmp_path / "clean", "clean")

    review, forecast = build_outputs(root)

    assert review["status"] == "clear"
    assert review["issues"] == []
    assert forecast is not None
    summary = forecast["summary"]
    assert summary["top_8_expected_value"] == 750_000
    assert summary["salesforce_longtail_expected_value"] == 60_000
    assert summary["carebridge_longtail_expected_value"] == 96_000
    assert summary["total_expected_sales"] == 906_000
    assert summary["variance_to_target"] == 906_000 - 12_000_000


def test_t02_salesforce_annual_amount_is_not_annualized(tmp_path) -> None:
    root = make_scenario_dataset(tmp_path / "salesforce-annual", "clean")

    review, forecast = build_outputs(root)

    assert review["status"] == "clear"
    assert forecast is not None
    deal = deal_by_id(forecast, "006TEST00000002AAA")
    assert deal["annual_acv"] == 100_000
    assert not any(
        item["type"] == "monthly_to_annual_conversion"
        and item["record_id"] == "006TEST00000002AAA"
        for item in forecast["audit_log"]
    )


def test_t03_carebridge_monthly_amount_is_annualized_and_audited(tmp_path) -> None:
    root = make_scenario_dataset(tmp_path / "carebridge-monthly", "clean")

    review, forecast = build_outputs(root)

    assert review["status"] == "clear"
    assert forecast is not None
    deal = deal_by_id(forecast, "HS-CLEAN-1")
    assert deal["annual_acv"] == 120_000
    audit = find_audit(forecast, "monthly_to_annual_conversion", "HS-CLEAN-1")
    assert audit["status"] == "automatically_resolved"
    assert audit["original_value"] == {"amount": 10_000, "billing_frequency": "Monthly"}
    assert audit["resulting_value"] == {"annual_acv": 120_000}


def test_t04_carebridge_annual_amount_is_not_annualized(tmp_path) -> None:
    root = make_scenario_dataset(tmp_path / "carebridge-annual", "carebridge_annual")

    review, forecast = build_outputs(root)

    assert review["status"] == "clear"
    assert forecast is not None
    deal = deal_by_id(forecast, "HS-CLEAN-1")
    assert deal["annual_acv"] == 120_000
    assert not any(item["type"] == "monthly_to_annual_conversion" for item in forecast["audit_log"])


def test_t06_valid_longtail_probability_is_used_as_supplied(tmp_path) -> None:
    root = make_scenario_dataset(
        tmp_path / "valid-stage-probability",
        "active_stage_probability_mismatch",
    )

    review, forecast = build_outputs(root)

    assert review["status"] == "clear"
    assert forecast is not None
    deal = deal_by_id(forecast, "006TEST00000002AAA")
    assert deal["stage"] == "Business Approval"
    assert deal["probability"] == 0.75
    assert deal["expected_value"] == 75_000


@pytest.mark.parametrize(
    ("scenario_id", "record_id", "appears_in_closed_lost_movement"),
    [
        ("closed_lost_salesforce", "006TEST00000003AAA", True),
        ("closed_lost_carebridge", "HS-CLOSED-1", False),
    ],
)
def test_t08_closed_lost_is_excluded_without_probability_rewrite(
    tmp_path,
    scenario_id,
    record_id,
    appears_in_closed_lost_movement,
) -> None:
    root = make_scenario_dataset(tmp_path / scenario_id, scenario_id)

    review, forecast = build_outputs(root)

    assert review["status"] == "clear"
    assert forecast is not None
    assert record_id not in {deal["opportunity_id"] for deal in forecast["deals"]}
    assert not any(
        audit["type"] == "closed_lost_probability_reset" and audit["record_id"] == record_id
        for audit in forecast["audit_log"]
    )
    movement_ids = {
        item["opportunity_id"] for item in forecast["week_over_week"]["closed_lost_deals"]
    }
    assert (record_id in movement_ids) is appears_in_closed_lost_movement


@pytest.mark.parametrize(
    ("gpa", "expected"),
    [(1.59, 0.10), (1.60, 0.30), (2.39, 0.30), (2.40, 0.50), (3.19, 0.50), (3.20, 0.75)],
)
def test_t09_probability_boundaries(gpa: float, expected: float) -> None:
    assert probability_from_gpa(gpa) == expected


def test_t09_weighted_top8_score() -> None:
    gpa, probability = calculate_top8_probability(4, 2, 2)
    assert gpa == 2.40
    assert probability == 0.50


def test_t10_scorecard_probability_uses_gpa_rule_and_is_audited(tmp_path) -> None:
    root = make_scenario_dataset(
        tmp_path / "scorecard-probability",
        "scorecard_probability_mismatch",
    )

    review, forecast = build_outputs(root)

    assert review["status"] == "clear"
    assert forecast is not None
    deal = next(deal for deal in forecast["deals"] if deal["forecast_bucket"] == "top_8")
    assert deal["top_8_scores"]["composite_gpa"] == 3.4
    assert deal["probability"] == 0.75
    audit = find_audit(forecast, "scorecard_probability_mismatch", deal["opportunity_id"])
    assert audit["status"] == "automatically_resolved"
    assert audit["original_value"]["workbook_probability"] == 0.50
    assert audit["resulting_value"]["rule_probability"] == 0.75


def test_t16_extra_source_column_is_ignored(tmp_path) -> None:
    root = make_scenario_dataset(tmp_path / "extra-column", "clean")
    path = root / "data/input/1_sfdc_pipeline_current.csv"
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
        headers = list(reader.fieldnames or []) + ["Unrelated_Column"]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        writer.writerows({**row, "Unrelated_Column": "ignored"} for row in rows)

    review, forecast = build_outputs(root)

    assert review["status"] == "clear"
    assert forecast is not None


def test_t17_exact_duplicate_is_counted_once_and_audited(tmp_path) -> None:
    root = make_scenario_dataset(tmp_path / "exact-duplicate", "exact_duplicate")

    review, forecast = build_outputs(root)

    assert review["status"] == "clear"
    assert forecast is not None
    assert sum(deal["opportunity_id"] == "006TEST00000002AAA" for deal in forecast["deals"]) == 1
    audit = find_audit(forecast, "exact_duplicate", "006TEST00000002AAA")
    assert audit["status"] == "automatically_resolved"
    assert audit["original_value"] == {"duplicate_count": 2}
    assert audit["resulting_value"]["calculation_record_count"] == 1


def test_t18_financial_variants_use_conservative_baseline(tmp_path) -> None:
    root = make_scenario_dataset(tmp_path / "two-variants", "two_conflicting_duplicates")

    review, forecast = build_outputs(root)

    assert review["status"] == "clear"
    assert forecast is not None
    deal = deal_by_id(forecast, "006TEST00000002AAA")
    assert deal["expected_value"] == 60_000
    assert len(deal["source_conflict"]["variants"]) == 2
    audit = find_audit(forecast, "conflicting_duplicate", deal["opportunity_id"])
    assert audit["status"] == "unresolved"
    assert audit["forecast_impact"] == {
        "baseline": 60_000,
        "maximum_alternative": 160_000,
        "difference": 100_000,
    }


def test_t18_exact_copies_do_not_create_additional_variants(tmp_path) -> None:
    root = make_scenario_dataset(
        tmp_path / "mixed-duplicates",
        "mixed_exact_and_conflicting_duplicates",
    )

    review, forecast = build_outputs(root)

    assert review["status"] == "clear"
    assert forecast is not None
    deal = deal_by_id(forecast, "006TEST00000002AAA")
    assert len(deal["source_conflict"]["variants"]) == 3
    assert {variant["expected_value"] for variant in deal["source_conflict"]["variants"]} == {
        60_000,
        120_000,
        160_000,
    }


def test_t20_equivalent_cross_source_deal_is_counted_once(tmp_path) -> None:
    root = make_scenario_dataset(tmp_path / "exact-cross-source", "equivalent_cross_source")

    review, forecast = build_outputs(root)

    assert review["status"] == "clear"
    assert forecast is not None
    assert any(deal["opportunity_id"] == "006TEST00000004AAA" for deal in forecast["deals"])
    assert not any(deal["opportunity_id"] == "HS-CLEAN-1" for deal in forecast["deals"])
    audit = find_audit(forecast, "cross_source_duplicate", "006TEST00000004AAA")
    assert audit["status"] == "automatically_resolved"
    assert audit["resulting_value"] == {"retained_source": "salesforce", "calculation_record_count": 1}


def test_t22_weak_cross_source_similarity_is_not_merged(tmp_path) -> None:
    root = make_scenario_dataset(
        tmp_path / "weak-cross-source",
        "weak_cross_source_similarity",
    )

    review, forecast = build_outputs(root)

    assert review["status"] == "clear"
    assert forecast is not None
    ids = {deal["opportunity_id"] for deal in forecast["deals"]}
    assert "006TEST00000005AAA" in ids
    assert "HS-CLEAN-1" in ids


def test_t26_invalid_close_date_publishes_with_warning(tmp_path) -> None:
    root = make_scenario_dataset(tmp_path / "invalid-date", "invalid_close_date")

    review, forecast = build_outputs(root)

    assert review["status"] == "clear"
    assert forecast is not None
    audit = find_audit(forecast, "invalid_close_date", "006TEST00000002AAA")
    assert audit["status"] == "warning"
    assert audit["original_value"] == {"close_date": "not-a-date"}
    assert audit["resulting_value"] is None
    assert audit["forecast_impact"] == 0


def test_t27_stale_close_date_publishes_with_warning(tmp_path) -> None:
    root = make_scenario_dataset(tmp_path / "stale-date", "stale_close_date")

    review, forecast = build_outputs(root)

    assert review["status"] == "clear"
    assert forecast is not None
    assert deal_by_id(forecast, "006TEST00000002AAA")
    audit = find_audit(forecast, "stale_close_date", "006TEST00000002AAA")
    assert audit["status"] == "warning"
    assert audit["forecast_impact"] == 0
