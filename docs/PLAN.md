# PulseFlow Health Forecast — Final Implementation Plan

This plan describes the implemented system. [`DOCUMENTATION.md`](DOCUMENTATION.md) explains the decisions in depth, while [`TESTS.md`](TESTS.md) is the exact behavioral contract.

## 1. Goal

Turn four selected sales exports into a reproducible Q4 forecast, week-over-week comparison, and audit trail without modifying the source files.

The system publishes only when every blocking issue has either been corrected in the source or resolved by a supported human decision.

## 2. Files and responsibilities

```text
data/input/                 CSV and XLSX source exports
config/input_files.json     Assigns one input filename to each of the four roles
config/resolutions.json     Confirmed human decisions
pipeline/process_data.py    Validation, reconciliation, calculations, and outputs
data/output/review.json     Latest clear or blocked review result
data/output/forecast.json   Last successfully published forecast
app/                        Dashboard and blocker-resolution interface
tests/                      Reproducible pytest fixtures and scenarios
docs/TESTS.md               Numbered behavioral contract
docs/DOCUMENTATION.md       Detailed explanation and design decisions
```

The four roles in `config/input_files.json` are:

- `salesforce_current`
- `salesforce_prior`
- `vp_scorecard`
- `carebridge_current`

All selected files must be inside `data/input/`. A new weekly export requires changing only these filename assignments; pipeline behavior remains unchanged.

## 3. Pipeline flow

```text
selected inputs + resolutions
              |
              v
validate -> standardize -> deduplicate -> reconcile
              |
              v
calculate -> compare weeks -> audit
        /                       \
   blocked                      clear
      |                           |
update review             update review and forecast
preserve old forecast
```

Every run rebuilds the result from the selected inputs and the complete resolution file. Generated JSON is never edited manually.

## 4. Publication rules

The pipeline has three outcomes:

- **Accepted:** valid source data is used directly or transformed by an unambiguous rule.
- **Audited:** publication continues, but a transformation, warning, or confirmed human decision is recorded.
- **Blocked:** no safe answer exists; `review.json` provides the source, row, evidence, and required action, and no new forecast is published.

Examples of deterministic behavior include annualizing monthly CareBridge amounts, normalizing known capitalization, recalculating Top 8 probability, and collapsing exact duplicates.

Examples of blockers include malformed records, missing required inputs, conflicting duplicates, materially conflicting cross-source copies, and ambiguous scorecard mappings.

## 5. Forecast rules

### Annual ACV

- Salesforce amounts are already annual.
- Monthly CareBridge amounts are multiplied by 12.
- Annual CareBridge amounts are used as supplied.

### Top 8

```text
GPA = round(20% Leadership + 20% Commercial + 60% Contractual, 2)

GPA >= 3.20  -> 75%
GPA >= 2.40  -> 50%
GPA >= 1.60  -> 30%
otherwise    -> 10%
```

The calculated probability controls and any workbook disagreement is audited.

### Longtail

Active Q4 deals outside the Top 8 use the valid probability supplied by their source. The pipeline accepts values from 0 through 1 and does not force stage/probability pairs.

```text
Expected value = annual ACV x probability
Total forecast = Top 8 + Salesforce longtail + CareBridge longtail
Variance = total forecast - $12,000,000
```

Closed Lost records are excluded from the active forecast without inspecting or rewriting their supplied probability.

## 6. Identifier and duplicate rules

- Accept 15- or 18-character Salesforce IDs.
- Preserve the original ID for display and auditing.
- Use the exact, case-sensitive first 15 characters for duplicate detection, scorecard matching, resolutions, and current-versus-prior comparison.
- Ignore the final three characters for matching; do not edit the source ID.
- Collapse exact same-source copies and audit the action.
- Block every meaningful same-source conflict until one authoritative source row is selected.
- Resolve current and prior conflicts independently because they are different snapshots.
- Count a strong equivalent Salesforce/CareBridge match once; block when a strong match contains a material conflict.

No unresolved duplicate variant is published to the forecast or Deal Room.

## 7. Human resolutions

One cumulative `config/resolutions.json` supports:

- `scorecard_mappings`: map a scorecard source row to a confirmed Salesforce opportunity.
- `duplicate_selections`: choose one row using source filename, canonical 15-character ID, selected source row, and reason.
- `record_overrides`: correct one allowed source field with an explicit reason.

The independent Pipeline Review page reads blockers from `review.json` and can download a complete `resolutions.json`. The operator replaces the existing config file, reruns the pipeline, and confirms the resulting audit entry. Missing files, missing columns, and unsupported structural problems remain source-file fixes.

## 8. Week-over-week rules

Current and prior Salesforce snapshots are standardized and deduplicated before comparison. Equivalent 15- and 18-character representations match as the same opportunity.

The output reports:

- new records;
- Q4 deals slipped to Q1;
- newly Closed Lost deals;
- ordered stage advances or regressions; and
- annual ACV increases or decreases.

A deal is new only when its canonical 15-character ID is absent from the prior file. Stage and fiscal period do not change that definition.

## 9. Dashboard behavior

- **Overview:** published totals, target variance, and forecast composition.
- **Deal Room:** browser-only score and probability-model what-if analysis.
- **Week over week:** the five movement categories.
- **Data hygiene:** automatic changes, warnings, and human-confirmed resolutions.
- **Pipeline Review:** a separate blocker interface shown instead of the dashboard when the latest run is blocked.

Browser what-if changes never modify inputs, resolutions, generated JSON, or the audit log. Refreshing or resetting restores the published baseline.

## 10. Verification and completion

The committed fixtures cover valid calculations, automatic audits, blockers, resolutions, duplicate selection in both weekly files, and mixed 15-/18-character Salesforce IDs.

Run the final checks from the repository root:

```bash
.venv/bin/python -m pytest -q
cd app
npm run build
```

Implementation is complete when all scenarios in `TESTS.md` pass, the frontend build succeeds, a blocked run preserves the previous forecast, and a clear run publishes matching review and forecast outputs.
