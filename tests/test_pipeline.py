from __future__ import annotations

import json
from pathlib import Path

from pipeline.process_data import build_outputs, build_week_over_week


ROOT = Path(__file__).resolve().parents[1]


def valid_resolutions() -> dict:
    return json.loads((ROOT / "config/resolutions.json").read_text(encoding="utf-8"))


def movement_record(record_id: str, **overrides) -> dict:
    record = {
        "canonical_id": record_id,
        "source_id": record_id,
        "Health_System": f"Health {record_id}",
        "Product": "PulseOR",
        "Sales_Rep": "Test Rep",
        "Fiscal_Period": "Q4-2026",
        "Stage": "Introduction",
        "stage_probability": 0.20,
        "annual_acv": 100_000,
    }
    record.update(overrides)
    return record


def test_t01_supplied_data_builds_complete_forecast() -> None:
    review, forecast = build_outputs(ROOT)

    assert review["status"] == "clear"
    assert forecast is not None
    assert sum(deal["forecast_bucket"] == "top_8" for deal in forecast["deals"]) == 8
    assert all(0 <= deal["probability"] <= 1 for deal in forecast["deals"])
    assert all(deal["annual_acv"] >= 0 for deal in forecast["deals"])


def test_t28_new_deal_is_reported_regardless_of_period_or_stage() -> None:
    prior = [movement_record("prior")]
    current = [
        movement_record("prior"),
        movement_record("new-q1", Fiscal_Period="Q1-2027"),
        movement_record("new-lost", Stage="Closed Lost"),
    ]

    movement = build_week_over_week(current, prior)

    assert {item["opportunity_id"] for item in movement["new_deals"]} == {
        "new-q1",
        "new-lost",
    }


def test_t29_q4_to_q1_deal_is_reported_as_slipped() -> None:
    prior = [movement_record("slipped")]
    current = [movement_record("slipped", Fiscal_Period="Q1-2027")]

    movement = build_week_over_week(current, prior)

    assert len(movement["slipped_deals"]) == 1
    assert movement["slipped_deals"][0]["opportunity_id"] == "slipped"
    assert movement["slipped_deals"][0]["prior_fiscal_period"] == "Q4-2026"
    assert movement["slipped_deals"][0]["current_fiscal_period"] == "Q1-2027"


def test_t30_newly_closed_lost_deal_is_reported_and_not_active() -> None:
    prior = [movement_record("lost", Stage="Business Approval", stage_probability=0.60)]
    current = [movement_record("lost", Stage="Closed Lost")]

    movement = build_week_over_week(current, prior)

    assert len(movement["closed_lost_deals"]) == 1
    assert movement["closed_lost_deals"][0]["opportunity_id"] == "lost"
    assert movement["closed_lost_deals"][0]["prior_stage"] == "Business Approval"
    assert movement["closed_lost_deals"][0]["current_stage"] == "Closed Lost"


def test_t31_active_q4_stage_move_reports_direction() -> None:
    prior = [movement_record("moved", Stage="Technical Validation", stage_probability=0.40)]
    current = [movement_record("moved", Stage="Contract Negotiations", stage_probability=0.80)]

    movement = build_week_over_week(current, prior)

    assert len(movement["stage_moves"]) == 1
    move = movement["stage_moves"][0]
    assert move["opportunity_id"] == "moved"
    assert move["prior_stage"] == "Technical Validation"
    assert move["current_stage"] == "Contract Negotiations"
    assert move["direction"] == "advanced"


def test_t32_active_q4_acv_change_reports_amount_and_direction() -> None:
    prior = [movement_record("expanded", annual_acv=100_000)]
    current = [movement_record("expanded", annual_acv=125_000)]

    movement = build_week_over_week(current, prior)

    assert len(movement["acv_changes"]) == 1
    change = movement["acv_changes"][0]
    assert change["opportunity_id"] == "expanded"
    assert change["prior_annual_acv"] == 100_000
    assert change["current_annual_acv"] == 125_000
    assert change["change"] == 25_000
    assert change["direction"] == "increase"


def test_t33_confirmed_scorecard_mappings_are_applied_and_audited() -> None:
    review, forecast = build_outputs(ROOT)

    assert review["status"] == "clear"
    assert review["issues"] == []
    assert "scorecard_mapping_reviews" not in review
    assert forecast is not None
    mappings = [entry for entry in forecast["audit_log"] if entry["type"] == "missing_scorecard_id"]
    assert len(mappings) == 4
    assert all(entry["status"] == "human_resolved" for entry in mappings)
    assert all(entry["resolution_source"] == "config/resolutions.json" for entry in mappings)
    assert {entry["source_rows"][0] for entry in mappings} == {9, 10, 11, 12}


def test_t34_confirmed_duplicate_selection_uses_selected_row_and_is_audited() -> None:
    resolutions = valid_resolutions()
    resolutions["duplicate_selections"] = [
        {
            "opportunity_id": "006PF000001L008YAC",
            "selected_source_row": 11,
            "reason": "Confirmed by test owner",
        }
    ]

    review, forecast = build_outputs(ROOT, resolutions_override=resolutions)

    assert review["status"] == "clear"
    assert forecast is not None
    deal = next(item for item in forecast["deals"] if item["opportunity_id"] == "006PF000001L008YAC")
    assert deal["expected_value"] == 440_000
    assert deal["source_conflict"] is None
    audit = next(
        item
        for item in forecast["audit_log"]
        if item["type"] == "conflicting_duplicate" and item["record_id"] == "006PF000001L008YAC"
    )
    assert audit["status"] == "human_resolved"
    assert audit["resolution_source"] == "config/resolutions.json"


def test_t35_confirmed_record_override_is_applied_and_audited() -> None:
    resolutions = valid_resolutions()
    resolutions["record_overrides"] = [
        {
            "source": "1_sfdc_pipeline_current.csv",
            "record_id": "006PF000001L001YAC",
            "field": "Amount",
            "value": 500000,
            "reason": "Confirmed test correction",
        }
    ]

    review, forecast = build_outputs(ROOT, resolutions_override=resolutions)

    assert review["status"] == "clear"
    assert forecast is not None
    deal = next(item for item in forecast["deals"] if item["opportunity_id"] == "006PF000001L001YAC")
    assert deal["annual_acv"] == 500_000
    audit = next(item for item in forecast["audit_log"] if item["type"] == "manual_record_override")
    assert audit["status"] == "human_resolved"
    assert audit["original_value"] == {"field": "Amount", "value": "450000"}
    assert audit["resulting_value"] == {"field": "Amount", "value": 500000}


def test_t36_stale_resolution_blocks_publication() -> None:
    resolutions = valid_resolutions()
    resolutions["record_overrides"] = [
        {
            "source": "unsupported.csv",
            "record_id": "missing-record",
            "field": "Amount",
            "value": 500000,
            "reason": "Stale test correction",
        }
    ]

    review, forecast = build_outputs(ROOT, resolutions_override=resolutions)

    assert review["status"] == "blocked"
    assert forecast is None
    assert any(issue["type"] == "stale_record_override" for issue in review["issues"])


def test_t36_scorecard_mapping_without_reason_blocks_publication() -> None:
    resolutions = valid_resolutions()
    resolutions["scorecard_mappings"] = [
        {
            "source_row": 9,
            "opportunity_id": "006PF000001T005YAC",
        }
    ]

    review, forecast = build_outputs(ROOT, resolutions_override=resolutions)

    assert review["status"] == "blocked"
    assert forecast is None
    issue = next(issue for issue in review["issues"] if issue["type"] == "invalid_resolution")
    assert issue["source_rows"] == [9]
    assert issue["evidence"] == resolutions["scorecard_mappings"][0]


def test_t36_stale_scorecard_source_row_blocks_publication() -> None:
    resolutions = valid_resolutions()
    resolutions["scorecard_mappings"] = [
        {
            "source_row": 99,
            "opportunity_id": "006PF000001T005YAC",
            "reason": "Outdated scorecard row",
        }
    ]

    review, forecast = build_outputs(ROOT, resolutions_override=resolutions)

    assert review["status"] == "blocked"
    assert forecast is None
    issue = next(issue for issue in review["issues"] if issue["type"] == "stale_scorecard_mapping")
    assert issue["source_rows"] == [99]
    assert issue["evidence"] == resolutions["scorecard_mappings"][0]
