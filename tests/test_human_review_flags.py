from __future__ import annotations

from pipeline.process_data import build_outputs
from tests.fixture_factory import find_audit, find_issue, make_scenario_dataset


def test_t12_missing_scorecard_id_exact_identity_is_automatically_mapped(tmp_path) -> None:
    root = make_scenario_dataset(tmp_path / "missing-scorecard-id", "missing_scorecard_id")

    review, forecast = build_outputs(root)

    assert review["status"] == "clear"
    assert review["issues"] == []
    assert "scorecard_mapping_reviews" not in review
    assert forecast is not None
    audit = find_audit(forecast, "missing_scorecard_id", "006TEST00000001AAA")
    assert audit["status"] == "automatically_resolved"
    assert audit["resolution_source"] == "exact_scorecard_identity_match"


def test_t13_supplied_scorecard_id_without_salesforce_match_blocks(tmp_path) -> None:
    root = make_scenario_dataset(tmp_path / "unmatched-scorecard-id", "unmatched_scorecard_id")

    review, forecast = build_outputs(root)

    assert review["status"] == "blocked"
    assert forecast is None
    issue = next(issue for issue in review["issues"] if issue["type"] == "unmatched_scorecard_id")
    assert issue["source"] == "3_vp_deal_scorecard.xlsx"
    assert issue["source_rows"] == [5]


def test_t14_missing_required_source_file_returns_blocked_review(tmp_path) -> None:
    root = make_scenario_dataset(tmp_path / "missing-file", "clean")
    (root / "data/input/4_carebridge_hubspot_export.csv").unlink()

    review, forecast = build_outputs(root)

    assert review["status"] == "blocked"
    assert forecast is None
    issue = next(issue for issue in review["issues"] if issue["type"] == "missing_source_file")
    assert issue["source"] == "4_carebridge_hubspot_export.csv"


def test_t15_missing_required_column_returns_blocked_review(tmp_path) -> None:
    root = make_scenario_dataset(tmp_path / "missing-column", "missing_required_column")

    review, forecast = build_outputs(root)

    assert review["status"] == "blocked"
    assert forecast is None
    issue = next(issue for issue in review["issues"] if issue["type"] == "missing_required_columns")
    assert issue["source"] == "1_sfdc_pipeline_current.csv"
    assert issue["evidence"] == {"missing_columns": ["Amount"]}


def test_t19_same_id_with_conflicting_identity_blocks(tmp_path) -> None:
    root = make_scenario_dataset(
        tmp_path / "identity-conflict",
        "duplicate_identity_disagreement",
    )

    review, forecast = build_outputs(root)

    assert review["status"] == "blocked"
    assert forecast is None
    issue = find_issue(review, "conflicting_duplicate", "006TEST00000002AAA")
    assert issue["source_rows"] == [3, 4]
    assert issue["required_action"]


def test_t21_cross_source_material_conflict_blocks(tmp_path) -> None:
    root = make_scenario_dataset(
        tmp_path / "cross-source-conflict",
        "cross_source_value_conflict",
    )

    review, forecast = build_outputs(root)

    assert review["status"] == "blocked"
    assert forecast is None
    issue = find_issue(review, "potential_cross_source_duplicate", "006TEST00000004AAA")
    assert issue["evidence"]["salesforce_id"] == "006TEST00000004AAA"
    assert issue["evidence"]["hubspot_id"] == "HS-CLEAN-1"


def test_t37_missing_scorecard_id_without_exact_identity_blocks(tmp_path) -> None:
    root = make_scenario_dataset(
        tmp_path / "missing-scorecard-id-mismatch",
        "missing_scorecard_id_identity_mismatch",
    )

    review, forecast = build_outputs(root)

    assert review["status"] == "blocked"
    assert forecast is None
    issue = next(issue for issue in review["issues"] if issue["type"] == "missing_scorecard_id")
    assert issue["source"] == "3_vp_deal_scorecard.xlsx"
    assert issue["source_rows"] == [5]
    assert issue["evidence"]["candidates"]
    assert issue["required_action"] == "Confirm an opportunity ID in config/resolutions.json"
    assert "scorecard_mapping_reviews" not in review


def test_t38_same_hospital_scorecard_rows_are_resolved_independently_by_source_row(tmp_path) -> None:
    root = make_scenario_dataset(
        tmp_path / "same-hospital-scorecard-rows",
        "two_scorecard_rows_same_hospital",
    )
    resolutions = {
        "scorecard_mappings": [
            {
                "source_row": 5,
                "opportunity_id": "006TEST00000001AAA",
                "reason": "Confirmed first hospital opportunity",
            },
            {
                "source_row": 6,
                "opportunity_id": "006TEST00000003AAA",
                "reason": "Confirmed second hospital opportunity",
            },
        ],
        "duplicate_selections": [],
        "record_overrides": [],
    }

    review, forecast = build_outputs(root, resolutions_override=resolutions)

    assert review["status"] == "clear"
    assert review["issues"] == []
    assert "scorecard_mapping_reviews" not in review
    assert forecast is not None
    mapping_audits = [
        entry for entry in forecast["audit_log"] if entry["type"] == "missing_scorecard_id"
    ]
    assert {entry["source_rows"][0] for entry in mapping_audits} == {5, 6}
    assert {entry["record_id"] for entry in mapping_audits} == {
        "006TEST00000001AAA",
        "006TEST00000003AAA",
    }
    assert all(entry["status"] == "human_resolved" for entry in mapping_audits)
