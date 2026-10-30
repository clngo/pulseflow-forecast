# PulseFlow Health Q4 Forecast

This project turns four sales exports into a checked, repeatable Q4 forecast and an interactive dashboard. It is designed so a business user can understand what was counted, what was corrected automatically, and what still needs a human decision.

The displayed totals come from the last successful pipeline run. Always check `data/output/review.json` before assuming a newly selected input file has been published.

## What the project does

1. Reads the current and prior Salesforce exports, the VP scorecard, and the CareBridge export.
2. Checks for invalid data, duplicates, conflicting records, and missing scorecard IDs.
3. Standardizes annual contract values and calculates expected sales.
4. Produces week-over-week changes and a complete audit trail.
5. Publishes the result for the dashboard only when no blocking issue remains.

The source CSV and Excel files are never changed by the pipeline.

## The four dashboard views

- **Overview** shows the official forecast, board-target variance, and forecast composition.
- **Deal Room** provides browser-only what-if analysis. Changes here do not change the official forecast.
- **Week over week** shows new, slipped, Closed Lost, stage-movement, and ACV-change records.
- **Data hygiene** shows automatic corrections, warnings, and confirmed human decisions.

## Run the dashboard

The latest generated forecast is already included.

```bash
cd app
npm install
npm run dev
```

Open the address shown by Vite, normally `http://localhost:5173`.

## Run the data pipeline

### Choose the four input files

Put every new CSV or Excel export in `data/input/`. Then open `config/input_files.json` and enter the filename that should fill each role:

```json
{
  "salesforce_current": "1_sfdc_pipeline_current.csv",
  "salesforce_prior": "2_sfdc_pipeline_prior_week.csv",
  "vp_scorecard": "3_vp_deal_scorecard.xlsx",
  "carebridge_current": "4_carebridge_hubspot_export.csv"
}
```

Only change the filenames. The pipeline always looks for them inside `data/input/` and ignores other files in that folder.

When a new Salesforce week arrives, make the old current file the prior file and make the new file current. For example:

```json
{
  "salesforce_current": "week_2_update.csv",
  "salesforce_prior": "1_sfdc_pipeline_current.csv",
  "vp_scorecard": "3_vp_deal_scorecard.xlsx",
  "carebridge_current": "4_carebridge_hubspot_export.csv"
}
```

If a new VP scorecard or CareBridge export arrives, replace only that role's filename. Do not rename files in the Python code. `config/input_files.json` must contain all four roles, and each named file must exist in `data/input/`.

From the project root:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python pipeline/process_data.py
```

The pipeline creates:

- `data/output/review.json`: whether the run is clear or blocked, with evidence and required actions.
- `data/output/forecast.json`: the last successfully published forecast used by the dashboard.

If a run is blocked, `review.json` is updated but the last valid `forecast.json` is preserved.

## Resolving a blocker

When `review.json` contains blockers, the browser shows a separate **Pipeline Review** page instead of the forecast dashboard. Each issue identifies the source file, source row, record ID, evidence, and required action.

For supported human decisions, complete the fields on that page and click **Download resolutions.json**. The downloaded file includes the existing valid decisions plus the new corrections. Replace `config/resolutions.json` with that download, rerun the pipeline, and refresh the browser.

Some problems cannot be safely handled as a resolution—for example, a missing required column. The page labels these as **Source file** fixes and tells you which input must be corrected. It never modifies a CSV or Excel file.

Most human-confirmed decisions belong in `config/resolutions.json`. Do not edit `forecast.json` or `review.json`; they are regenerated on every run.

Use **one continuing `config/resolutions.json` file**. When you confirm another correction, add it to the appropriate section of that same file. Do not create a new resolution file for each decision or replace the file with only the newest decision. Keep earlier decisions for as long as they remain valid.

The resolution file always has these three sections:

```json
{
  "scorecard_mappings": [],
  "duplicate_selections": [],
  "record_overrides": []
}
```

### 1. Confirm a missing scorecard ID

When the scorecard has no Salesforce ID and the pipeline cannot find one unique exact match, `review.json` provides the scorecard source row and ranked candidates. After a person confirms the correct opportunity, map that source row to the Salesforce ID:

```json
{
  "scorecard_mappings": [
    {
      "source_row": 10,
      "opportunity_id": "006PF000001T006YAC",
      "reason": "Confirmed against the current Salesforce pipeline"
    }
  ],
  "duplicate_selections": [],
  "record_overrides": []
}
```

Suggestions are evidence only; the pipeline never accepts a fuzzy name match automatically.

`source_row` identifies one specific Excel row, so separate deals for the same hospital can receive different mappings. Multiple mappings are added as separate objects inside the same `scorecard_mappings` list.

### 2. Select the authoritative duplicate

When rows in one source file share an ID but contain different meaningful values, the pipeline blocks publication. A person must confirm exactly one authoritative source row:

```json
{
  "scorecard_mappings": [],
  "duplicate_selections": [
    {
      "source": "1_sfdc_pipeline_current.csv",
      "opportunity_id": "006PF000001L008",
      "selected_source_row": 11,
      "reason": "Confirmed against the Salesforce opportunity history"
    }
  ],
  "record_overrides": []
}
```

Use the canonical first 15 characters of the Salesforce ID. The source filename and selected row must exactly match the conflict reported by the pipeline, and a reason is required. Current- and prior-week conflicts are resolved separately because each file can require a different authoritative row. The selected record is then used consistently by the forecast, week-over-week comparison, and Deal Room.

Salesforce exports may contain either 15- or 18-character IDs. The pipeline preserves the supplied value for display but compares records using the exact, case-sensitive first 15 characters. Therefore, a prior ID such as `006PF000001L008` and a current ID such as `006PF000001L008YAC` are the same deal, not a new deal.

### 3. Correct a known source value

If an authorized person knows that a particular exported value is wrong, record the correction without modifying the raw export:

```json
{
  "scorecard_mappings": [],
  "duplicate_selections": [],
  "record_overrides": [
    {
      "source": "1_sfdc_pipeline_current.csv",
      "record_id": "006PF000001L001YAC",
      "field": "Amount",
      "value": 500000,
      "reason": "Confirmed by the opportunity owner"
    }
  ]
}
```

Use the exact source filename, record ID, field name, and confirmed value. A reason is mandatory. If an ID appears more than once, include `"source_row": 10` to target exactly one row.

### Finish the resolution

1. Open the existing `config/resolutions.json`; do not create another resolution file.
2. Keep all previous valid decisions and add the new decision to the appropriate section. The file is cumulative.
3. Keep the JSON valid, including commas between multiple entries.
4. Rerun `.venv/bin/python pipeline/process_data.py`.
5. Confirm that `review.json` is clear.
6. Check the Data hygiene tab for the `human_resolved` audit entry.

Some blockers cannot be fixed through `resolutions.json`. A missing file or column must be restored, and an invalid scorecard value must be corrected in the scorecard source. An invalid or outdated resolution also blocks publication rather than being silently ignored.

## Run the checks

```bash
.venv/bin/python -m pytest -q
cd app
npm run build
```

The pipeline behavior is defined by numbered scenarios in [`docs/TESTS.md`](docs/TESTS.md). The deeper rationale, tradeoffs, and future production direction are in [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md).

## Project map

```text
data/input/                 Current and archived source exports
data/output/review.json     Current validation and review result
data/output/forecast.json   Last successfully published forecast
config/input_files.json     Selects the four files used for the next run
config/resolutions.json     Durable human-confirmed decisions
pipeline/process_data.py    Validation, reconciliation, and calculation
tests/                      Reproducible automated tests and fixtures
app/                        Interactive dashboard
docs/DOCUMENTATION.md       Detailed system explanation and decisions
docs/TESTS.md               Numbered behavioral test contract
docs/PLAN.md                Final implemented plan and acceptance status
docs/README_CHALLENGE.md    Original exercise requirements
```

This repository is intentionally file-based. It does not require a database, API, authentication system, or source-system writeback to demonstrate a trustworthy and reproducible forecast workflow.
