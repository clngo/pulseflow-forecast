# PulseFlow Health Forecast — Implementation Plan

> **Historical planning artifact:** this file records the implementation plan before finalization. The authoritative description of the completed system is [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md), and the behavioral contract is [`docs/TESTS.md`](docs/TESTS.md).

## 1. Goal

Build a repeatable pipeline and dashboard that answer:

> How much new annual software sales are expected to close in Q4 2026, and how does that compare with the $12 million board target?

The project must:

- Read the four supplied CSV/XLSX exports without modifying them.
- Standardize and validate records before calculating the forecast.
- Calculate Top 8 and longtail expected sales.
- Compare the current Salesforce export with the prior week.
- Detect duplicates, conflicts, and invalid source data.
- Generate clear review and audit evidence.
- Accept durable human corrections through one configuration file.
- Support temporary dashboard what-if scenarios without changing the pipeline result.

This is a take-home application. It does not require a database, API, authentication, or source-system writeback.

## 2. Project Structure

```text
candidate_packet/
├── data/
│   ├── input/
│   │   ├── 1_sfdc_pipeline_current.csv
│   │   ├── 2_sfdc_pipeline_prior_week.csv
│   │   ├── 3_vp_deal_scorecard.xlsx
│   │   └── 4_carebridge_hubspot_export.csv
│   └── output/
│       ├── review.json
│       └── forecast.json
├── config/
│   └── resolutions.json
├── pipeline/
│   └── process_data.py
├── tests/
│   ├── fixtures/
│   │   ├── baseline/
│   │   │   ├── data/input/       # Four small, valid synthetic source files
│   │   │   └── config/resolutions.json
│   │   └── scenarios.json        # Committed test mutations and expected outcomes
│   ├── fixture_factory.py
│   ├── test_correct_inputs.py
│   ├── test_human_review_flags.py
│   ├── test_invalid_data_errors.py
│   └── test_pipeline.py
├── app/
│   ├── src/
│   └── vite.config.ts
├── README_CHALLENGE.md
├── README.md
├── PLAN.md
└── requirements.txt
```

### File responsibilities

- `data/input/` contains the immutable business source files.
- `data/output/review.json` contains the latest validation and human-review result.
- `data/output/forecast.json` contains the last successfully published forecast, deal details, week-over-week analysis, and audit log.
- `config/resolutions.json` contains confirmed human corrections.
- `pipeline/process_data.py` owns validation, standardization, reconciliation, calculations, and output generation.
- `tests/fixtures/baseline/` contains a committed, inspectable synthetic dataset.
- `tests/fixtures/scenarios.json` defines each deliberate test mutation and its expected outcome.
- `tests/fixture_factory.py` copies the committed baseline into an isolated pytest working directory and applies the selected committed scenario. Temporary copies are never authoritative data.
- The React application reads the canonical `data/output/forecast.json` through Vite's public-directory configuration.

## 3. Pipeline Flow

```text
data/input/* + config/resolutions.json
                    ↓
              process_data.py
                    ↓
       validate → standardize → reconcile
                    ↓
          calculate → audit → publish
             /                    \
       blocked run            successful run
            ↓                       ↓
 replace review.json       replace review.json
 preserve forecast.json    replace forecast.json
```

Every run starts from the four source files and the complete resolutions file. Outputs are rebuilt rather than patched incrementally.

Run from the project root:

```bash
.venv/bin/python pipeline/process_data.py
```

## 4. The Three Processing Outcomes

Every record or conflict must end in one of three understandable outcomes.

### Correct

The record is valid as supplied, or a deterministic written rule produces one safe result.

Examples:

- Monthly CareBridge amount is converted to annual ACV.
- An exact duplicate is collapsed.
- A Top 8 probability is recalculated from the written GPA rule.
- A Closed Lost record is assigned 0% probability and excluded from forecast value.

The pipeline may publish the forecast. Any automatic correction must appear in the audit log.

### Human review

The data is valid enough to understand, but no written rule can safely choose the correct business answer.

Examples:

- Duplicate rows disagree on customer identity.
- Likely Salesforce and CareBridge copies disagree materially.
- A required scorecard opportunity ID is missing and has no unique exact hospital, product, and sales rep match.
- An active Salesforce stage and probability disagree.

The pipeline must block publication, explain the evidence in `review.json`, and request a specific human action.

One exception is an identity-consistent duplicate with multiple financially valid variants. The pipeline publishes the conservative variant as the baseline, preserves each distinct variant for dashboard analysis, and records the unresolved conflict in the audit log. Exact copies do not create additional variants.

### Invalid data

The source contains a value that violates the input contract or cannot represent a valid record.

Examples:

- Negative amount.
- Probability outside 0–1.
- Unsupported billing frequency.
- Malformed Salesforce ID.
- Impossible stage or active close date.
- Missing required column.
- Top 8 score outside 1–4.

The pipeline must block publication and classify the issue as `invalid_data` in `review.json`.

## 5. Forecast Rules

### Annual ACV

- Salesforce amounts are already annual ACV.
- CareBridge `Monthly` amounts are multiplied by 12.
- CareBridge `Annual` amounts are used as supplied.
- Unsupported billing frequencies are invalid data.

### Top 8

```text
GPA = round(20% × Leadership + 20% × Commercial + 60% × Contractual, 2)

GPA >= 3.20             → 75%
GPA >= 2.40 and < 3.20  → 50%
GPA >= 1.60 and < 2.40  → 30%
GPA < 1.60              → 10%

Expected value = annual ACV × GPA probability
```

The calculated GPA probability controls. A different workbook probability is not accepted as an override; it is corrected and audited.

### Longtail

Longtail consists of active Q4-2026 deals across Salesforce and CareBridge that are not in the Top 8.

```text
Expected value = annual ACV × validated source-stage probability
```

Closed Lost always has 0% probability, contributes $0, and cannot affect deal scoring.

### Total

```text
Total expected sales = Top 8 + Salesforce longtail + CareBridge longtail
Variance to target = Total expected sales − $12,000,000
```

## 6. Duplicate Handling

Process duplicates only after values and identifiers are standardized.

- Exact copies are counted once and audited.
- Same-source duplicates with the same business identity but different valid financial states become distinct forecast variants.
- The conservative variant is the pipeline baseline until a human confirms one.
- Identity disagreements block for human review.
- Equivalent Salesforce/CareBridge copies are counted once, retaining Salesforce as the calculation record.
- Likely cross-source copies with conflicting material values block for human review.

## 7. Human Corrections

Humans do not edit raw exports or generated JSON files. Confirmed decisions go in:

```text
config/resolutions.json
```

It supports:

- `scorecard_mappings`: confirm the Salesforce ID for a scorecard row.
- `duplicate_selections`: confirm the authoritative row for a known duplicate conflict.
- `record_overrides`: correct a specific source field with a reason.

For a blank scorecard ID, the pipeline automatically maps exactly one normalized hospital, product, and sales rep match and audits the decision. Otherwise, it generates ranked suggestions in `review.json`; fuzzy similarity never selects a mapping automatically.

Correction workflow:

1. Run the pipeline.
2. Read `data/output/review.json`.
3. Confirm the business answer.
4. Add or update the decision in `config/resolutions.json`.
5. Rerun the complete pipeline.
6. Verify the result and audit entry in `data/output/forecast.json` and the dashboard.

`resolutions.json` is cumulative. A rerun rebuilds both outputs from the raw files plus all active resolutions. A blocked rerun replaces `review.json` but preserves the last valid `forecast.json`.

## 8. Week-over-Week Rules

Compare standardized Salesforce current and prior-week records by canonical opportunity ID.

Report:

- New deals: present now and absent from the prior file, regardless of fiscal period or stage.
- Slipped deals.
- Newly Closed Lost deals.
- Stage changes.
- Annual ACV changes.

Standardization and duplicate handling occur before the weekly comparison.

## 9. Audit and Review Outputs

`review.json` is operational input for the human-review workflow. It contains blocking issues, invalid records, evidence, suggestions, and required actions.

`forecast.json` is the published dashboard artifact. Its `audit_log` contains automatic corrections, confirmed resolutions, warnings, duplicate treatment, unresolved forecast variants, original values, resulting values, and financial impact where applicable.

The dashboard's Data Hygiene view reads the audit log from `forecast.json`.

## 10. Dashboard Behavior

- **Overview:** published forecast, target variance, bucket totals, and confidence status.
- **Deal Room:** session-only score and source-variant what-if analysis.
- **Week over week:** new, slipped, Closed Lost, stage, and ACV changes.
- **Data hygiene:** automatic changes, human confirmations, warnings, and unresolved conflicts.

Deal Room controls never modify input files, `resolutions.json`, `review.json`, `forecast.json`, or the audit log. Reset or refresh restores the pipeline baseline.

## 11. Test Strategy

`docs/TESTS.md` is the source of truth for scenario definitions and expected behavior. This section only summarizes the test structure.

The committed test system has two parts:

1. `tests/fixtures/baseline/` provides real CSV/XLSX files that can be inspected in Git.
2. `tests/fixtures/scenarios.json` defines reproducible mutations and the expected outcome for every covered case.

During a test, `fixture_factory.py` copies the baseline to pytest's isolated directory and applies one scenario. This prevents a test from changing committed fixtures while keeping all authoritative inputs and mutations in the repository.

Test groups:

- `test_correct_inputs.py`: valid calculations and deterministic automatic corrections.
- `test_human_review_flags.py`: ambiguous conditions that must be surfaced or blocked.
- `test_invalid_data_errors.py`: impossible data and broken input contracts.
- `test_pipeline.py`: supplied-data integration and core business-rule boundaries.

Run:

```bash
.venv/bin/python -m pytest -q
```

Every contract scenario is identified by its stable `Txx` ID in both `docs/TESTS.md` and the pytest function name. The finalized suite passes all 50 test cases covering `T01` through `T38`.

## 12. Current Implementation Status

The pipeline currently satisfies the complete test contract:

- Closed Lost deals are excluded without inspecting or rewriting their probability.
- Blank scorecard IDs are mapped automatically only for one exact normalized hospital, product, and sales rep match; all other cases block with ranked suggestions.
- Missing source files and required columns return structured blocking review results.
- Strong cross-source identity matches with conflicting financial values block publication.
- Valid longtail probabilities from 0 through 1 are used as supplied.
- Invalid and stale close dates remain nonblocking audit warnings because Fiscal Period and Stage control eligibility.

The production data run generates a $12,982,400 forecast with 38 active deals and 20 audit entries. The dashboard reads the regenerated canonical forecast from `data/output/forecast.json`.
