# Pipeline Test Contract

## 1. Purpose

This file is the source of truth for pipeline behavior. Each scenario has a permanent ID. Pytest names must include that ID, for example:

```python
def test_t19_identity_conflict_blocks(...):
```

IDs are never reused or renumbered.

## 2. Return Contract

The pipeline returns:

```python
review, forecast = build_outputs(root)
```

### `PUBLISH`

```python
review["status"] == "clear"
review["blocking_issue_count"] == 0
review["issues"] == []
forecast is not None
```

### `BLOCK(issue_type)`

```python
review["status"] == "blocked"
review["blocking_issue_count"] >= 1
review["issues"] contains {
    "type": issue_type,
    "status": "blocking",
    "source": source_filename,
    "source_rows": source_rows,
    "record_id": record_id,
    "message": nonempty_string,
    "evidence": evidence,
    "required_action": nonempty_string,
}
forecast is None
```

### `AUDIT(audit_type, audit_status)`

`PUBLISH`, plus:

```python
forecast["audit_log"] contains {
    "type": audit_type,
    "status": audit_status,
    "source": source_filename,
    "source_rows": source_rows,
    "record_id": record_id,
    "original_value": original_value,
    "resulting_value": resulting_value,
    "action": nonempty_string,
    "resolution_source": nonempty_string,
    "forecast_impact": forecast_impact,
}
```

Generated timestamps and sequential `issue_id`/`audit_id` values are not compared exactly.

For a blocked command-line run, `review.json` is replaced and the last valid `forecast.json` is preserved.

## 3. Forecast and Validation Scenarios

| ID | Input condition | Required result |
|---|---|---|
| `T01` | All four inputs are valid. | `PUBLISH`; `total_expected_sales == top_8 + salesforce_longtail + carebridge_longtail`; `variance_to_target == total_expected_sales - 12000000`. |
| `T02` | Salesforce amount is `100000`, billing is `Annual`. | `PUBLISH`; `annual_acv == 100000`; no annualization audit. |
| `T03` | CareBridge amount is `10000`, billing is `Monthly`. | `AUDIT("monthly_to_annual_conversion", "automatically_resolved")`; `annual_acv == 120000`; original amount `10000`; resulting ACV `120000`. |
| `T04` | CareBridge amount is `120000`, billing is `Annual`. | `PUBLISH`; `annual_acv == 120000`; no annualization audit. |
| `T05` | Billing frequency is unsupported or blank. | `BLOCK("invalid_salesforce_record")` or `BLOCK("invalid_carebridge_record")`; evidence contains the supplied billing value. |
| `T06` | Longtail probability is numeric and `0 <= p <= 1`. | `PUBLISH`; `probability == p`; `expected_value == annual_acv * p`. Stage and probability do not need to match a standard pair. |
| `T07` | Probability is nonnumeric, blank, below 0, or above 1. | `BLOCK("invalid_salesforce_record")` or `BLOCK("invalid_carebridge_record")`. |
| `T08` | Current stage is `Closed Lost`. | `PUBLISH`; record is absent from `forecast["deals"]`. Its probability is not checked, changed, or audited. |

## 4. Top 8 Scenarios

| ID | Input condition | Required result |
|---|---|---|
| `T09` | Scores are whole numbers from 1 through 4. | `PUBLISH`; `gpa == round(.2*leadership + .2*commercial + .6*contractual, 2)`; expected value uses the GPA probability table. |
| `T10` | Workbook probability differs from the GPA-derived probability. | `AUDIT("scorecard_probability_mismatch", "automatically_resolved")`; published probability equals the GPA-derived probability. |
| `T11` | A score is blank, nonnumeric, fractional, below 1, or above 4. | `BLOCK("invalid_top8_scores")`; source is `3_vp_deal_scorecard.xlsx`. |
| `T12` | A populated scorecard row has no ID and exactly one Salesforce record has the same normalized hospital, product, and sales rep. | `AUDIT("missing_scorecard_id", "automatically_resolved")`; use the matched Salesforce ID; resolution source is `exact_scorecard_identity_match`. |
| `T13` | A supplied scorecard ID has no current Salesforce match. | `BLOCK("unmatched_scorecard_id")`. |

### Scorecard matching rules

Normalization ignores capitalization, punctuation, and repeated spaces. Automatic mapping requires exactly one match across hospital, product, and sales rep. When there is no unique exact match, candidates with the same Product and Sales Rep are ranked by normalized hospital-name similarity. Each suggestion contains opportunity ID, source row, hospital, product, sales rep, and similarity score. A suggestion is never selected automatically.

## 5. File Contract Scenarios

| ID | Input condition | Required result |
|---|---|---|
| `T14` | A required source file is absent. | `BLOCK("missing_source_file")`; issue source equals the missing filename. |
| `T15` | A required column is absent. | `BLOCK("missing_required_columns")`; `evidence == {"missing_columns": sorted_missing_columns}`. |
| `T16` | An unrelated extra column exists. | `PUBLISH`; extra column is ignored. |

## 6. Same-Source Duplicate Scenarios

| ID | Input condition | Required result |
|---|---|---|
| `T17` | Rows have the same source ID and identical meaningful values. | `AUDIT("exact_duplicate", "automatically_resolved")`; one published deal; audit records duplicate count and calculation count `1`. |
| `T18` | Rows in the current or prior file share an ID but contain different meaningful values. | `BLOCK("conflicting_duplicate")`; evidence contains each distinct conflicting row; exact copies do not add conflict choices; no forecast is published. |
| `T19` | Same source ID but different customer, product, or owner. | `BLOCK("conflicting_duplicate")`; evidence contains every conflicting source row; pipeline chooses neither identity. |

For `T18`, a conflict in either week is resolved separately using its source filename, canonical 15-character opportunity ID, and selected source row. The pipeline performs week-over-week comparison only after both files contain one authoritative record per ID.

## 7. Cross-Source Duplicate Scenarios

A strong match requires agreement on normalized customer, product, owner, and expected close date. Name similarity alone is not a strong match.

| ID | Input condition | Required result |
|---|---|---|
| `T20` | Salesforce and CareBridge strongly match and have equivalent annual values. | `AUDIT("cross_source_duplicate", "automatically_resolved")`; retain Salesforce; exclude CareBridge copy; calculation count `1`. |
| `T21` | Strong match, but annual ACV or another material financial value conflicts. | `BLOCK("potential_cross_source_duplicate")`; evidence contains both IDs, matching identity fields, and conflicting values. |
| `T22` | Customer names are similar but other strong-match fields disagree or are absent. | `PUBLISH`; do not merge the records automatically. |

## 8. Invalid Record and Warning Scenarios

| ID | Input condition | Required result |
|---|---|---|
| `T23` | Amount is negative. | `BLOCK("invalid_salesforce_record")` or `BLOCK("invalid_carebridge_record")`; evidence contains the amount. |
| `T24` | Salesforce opportunity ID is malformed. | `BLOCK("invalid_salesforce_record")`; evidence contains the supplied ID. |
| `T25` | Stage is unknown. | `BLOCK("invalid_salesforce_record")` or `BLOCK("invalid_carebridge_record")`; evidence contains the stage. |
| `T26` | Close date is unparseable or impossible. | `AUDIT("invalid_close_date", "warning")`; record remains eligible through Fiscal Period and Stage; resulting value is `None`; forecast impact is `0`. |
| `T27` | Active Q4 deal has a valid close date before `2026-10-15`. | `AUDIT("stale_close_date", "warning")`; deal remains included; forecast impact is `0`. |

## 9. Week-over-Week Scenarios

Current and prior Salesforce files are standardized and deduplicated before comparison.

| ID | Input condition | Required result |
|---|---|---|
| `T28` | ID is present now and absent before. | Deal appears once in `week_over_week.new_deals`, regardless of current fiscal period or stage. |
| `T29` | Prior period is `Q4-2026`; current period is `Q1-2027`. | Deal appears once in `week_over_week.slipped_deals`. |
| `T30` | Prior stage is open; current stage is `Closed Lost`. | Deal appears once in `week_over_week.closed_lost_deals` and is absent from active forecast deals. |
| `T31` | Active Q4 stage changed between ordered stages. | Deal appears once in `week_over_week.stage_moves`; prior/current stages and `advanced`/`regressed` direction are exact. |
| `T32` | Active Q4 annual ACV changed. | Deal appears once in `week_over_week.acv_changes`; `change == current_acv - prior_acv`; direction is exact. |
| `T41` | The prior file contains a 15-character Salesforce ID and the current file contains the equivalent 18-character ID. | Match using the exact, case-sensitive first 15 characters; do not report a new deal; report applicable stage and ACV changes using the original current-file ID. |

## 10. Resolution Scenarios

| ID | Input condition | Required result |
|---|---|---|
| `T33` | `resolutions.json` maps one blank-ID scorecard `source_row` to a valid Salesforce opportunity and includes a reason. | `AUDIT("missing_scorecard_id", "human_resolved")`; mapped Salesforce ID is used; audit source row equals the configured scorecard row; resolution source is `config/resolutions.json`. |
| `T34` | `resolutions.json` selects one valid duplicate row using source filename, canonical 15-character opportunity ID, source row, and reason. | `AUDIT("conflicting_duplicate", "human_resolved")`; selected row is used for forecast and week-over-week; `source_conflict is None`. |
| `T35` | `resolutions.json` provides a valid record override and reason. | `AUDIT("manual_record_override", "human_resolved")`; corrected field equals confirmed value; original and resulting values are exact. |
| `T36` | Resolution is incomplete or refers to an unsupported or stale record, scorecard row, source, or field. | `BLOCK("invalid_resolution")`, `BLOCK("stale_scorecard_mapping")`, `BLOCK("stale_record_override")`, or `BLOCK("stale_duplicate_resolution")`; evidence contains the invalid resolution. |
| `T37` | A scorecard row has no ID and no unique exact hospital, product, and sales rep match. | `BLOCK("missing_scorecard_id")`; `issues` contains the scorecard source row and ranked candidates; required action is confirmation in `config/resolutions.json`; no duplicate scorecard-review collection is returned. |
| `T38` | Two blank-ID scorecard rows use the same hospital name but map to different Salesforce deals by source row. | `PUBLISH`; two separate `AUDIT("missing_scorecard_id", "human_resolved")` entries use the configured source rows and opportunity IDs. |
| `T39` | A known stage or billing frequency differs from the official value only by capitalization. | `AUDIT("capitalization_normalization", "automatically_resolved")`; publish the official spelling; amount and probability are unchanged. |
| `T40` | Duplicate health-system or company names differ only by capitalization. | Treat the names as the same identity; preserve the retained row's original display spelling. |

## 11. Acceptance Rule

The pipeline conforms to this contract when every implemented pytest scenario `T01` through `T41` passes.

Adding a scenario requires the next unused ID, one new row in this document, and a pytest function containing the same ID.
