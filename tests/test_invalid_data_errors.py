from __future__ import annotations

import pytest

from pipeline.process_data import build_outputs
from tests.fixture_factory import find_issue, make_scenario_dataset


def assert_blocked_record(root, issue_type: str, record_id: str) -> dict:
    review, forecast = build_outputs(root)
    assert review["status"] == "blocked"
    assert forecast is None
    issue = find_issue(review, issue_type, record_id)
    assert issue["status"] == "blocking"
    assert issue["required_action"]
    return issue


def test_t05_unsupported_billing_frequency_blocks(tmp_path) -> None:
    root = make_scenario_dataset(
        tmp_path / "invalid-billing",
        "invalid_billing_frequency",
    )

    issue = assert_blocked_record(root, "invalid_salesforce_record", "006TEST00000002AAA")

    assert issue["source"] == "1_sfdc_pipeline_current.csv"
    assert issue["evidence"]["Billing_Frequency"] == "Quarterly"


@pytest.mark.parametrize(
    ("scenario_id", "issue_type", "record_id"),
    [
        ("invalid_probability", "invalid_salesforce_record", "006TEST00000002AAA"),
        ("invalid_carebridge_probability", "invalid_carebridge_record", "HS-CLEAN-1"),
    ],
)
def test_t07_probability_outside_zero_to_one_blocks(
    tmp_path,
    scenario_id,
    issue_type,
    record_id,
) -> None:
    root = make_scenario_dataset(tmp_path / scenario_id, scenario_id)

    issue = assert_blocked_record(root, issue_type, record_id)

    assert issue["evidence"]["Stage_Probability"] == "1.25"


def test_t11_invalid_top8_score_blocks(tmp_path) -> None:
    root = make_scenario_dataset(tmp_path / "invalid-score", "invalid_scorecard_score")

    issue = assert_blocked_record(root, "invalid_top8_scores", "006TEST00000001AAA")

    assert issue["source"] == "3_vp_deal_scorecard.xlsx"
    assert issue["source_rows"] == [5]


def test_t23_negative_amount_blocks(tmp_path) -> None:
    root = make_scenario_dataset(tmp_path / "negative-amount", "invalid_negative_amount")

    issue = assert_blocked_record(root, "invalid_salesforce_record", "006TEST00000002AAA")

    assert issue["evidence"]["Amount"] == "-1"


def test_t24_malformed_salesforce_id_blocks(tmp_path) -> None:
    root = make_scenario_dataset(tmp_path / "invalid-id", "invalid_opportunity_id")

    issue = assert_blocked_record(root, "invalid_salesforce_record", "bad-id")

    assert issue["evidence"]["Opportunity_ID"] == "bad-id"


def test_t25_unknown_stage_blocks(tmp_path) -> None:
    root = make_scenario_dataset(tmp_path / "invalid-stage", "invalid_stage")

    issue = assert_blocked_record(root, "invalid_salesforce_record", "006TEST00000002AAA")

    assert issue["evidence"]["Stage"] == "Impossible Stage"
