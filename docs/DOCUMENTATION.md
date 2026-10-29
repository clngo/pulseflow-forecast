# PulseFlow Forecast System Documentation

## 1. Purpose

PulseFlow turns four sales exports into an executive Q4 forecast that can be reproduced and audited. The system is intentionally small: one Python pipeline produces JSON files, and one React application displays them.

The central principle is simple:

> Automate conclusions that are supported by explicit rules, and ask a human when the data does not establish one correct business answer.

The project preserves the supplied files, records every material transformation, and keeps temporary dashboard scenarios separate from the official forecast.

## 2. System at a glance

```text
Four source exports + confirmed human resolutions
                         |
                         v
       validate -> standardize -> reconcile
                         |
                         v
          calculate -> compare -> audit
                    /             \
             blocked run      clear run
                  |                |
           update review      update review
          preserve forecast   publish forecast
```

Every run starts again from the four source files selected in `config/input_files.json` and the decisions in `config/resolutions.json`. Outputs are rebuilt; the pipeline does not make incremental edits to an older forecast.

## 3. Inputs and outputs

### Inputs

| Entry | Purpose |
|---|---|
| `salesforce_current` | Current Salesforce pipeline state |
| `salesforce_prior` | Prior Salesforce state for weekly comparison |
| `vp_scorecard` | Readiness scores for the eight strategic deals |
| `carebridge_current` | Current CareBridge pipeline exported from HubSpot |
| `config/resolutions.json` | Confirmed human decisions applied during the run |

The four role names are mapped to filenames in `config/input_files.json`. All referenced files must be present in `data/input/`. Changing a weekly input requires editing only the relevant filename in this configuration; calculation and validation behavior remain unchanged. Files in `data/input/` that are not selected are ignored, allowing older snapshots to remain available.

The source exports are treated as evidence and are never modified by the pipeline. A missing or malformed input configuration is a setup error and leaves generated outputs untouched.

### Outputs

`data/output/review.json` is the operator-facing result. It says whether publication is clear or blocked and provides evidence and a required action for every blocker.

`data/output/forecast.json` is the published dashboard snapshot. It contains the forecast summary, active deals, week-over-week movement, and audit log.

A blocked command updates `review.json` but preserves the last valid `forecast.json`. This prevents bad input from replacing a usable dashboard snapshot. Anyone operating the system should check the review status and forecast generation timestamp rather than assuming the dashboard was refreshed.

## 4. The three data outcomes

### Accepted

The record is valid and can be used as supplied. It may also undergo a deterministic transformation, such as converting a monthly amount to annual ACV.

### Audited

The forecast may publish, but the pipeline records something worth explaining. Examples include an exact duplicate being removed, a workbook probability being replaced by the written GPA rule, a stale close date, or a human-confirmed resolution.

An identity-consistent duplicate conflict is also allowed to publish as an unresolved forecast variant. The lowest expected value becomes the conservative baseline, and the other valid source states remain visible in the Deal Room.

### Blocked

The pipeline cannot establish a safe result. Examples include a missing required file, invalid amount, unknown stage, identity-conflicting duplicate, materially conflicting cross-system copy, or missing scorecard ID with no unique exact match.

When blocked, the pipeline returns no new forecast object. The issue must be corrected in the source or resolved through an allowed human decision.

## 5. Forecast calculations

### Annual contract value

- Salesforce amounts are treated as annual.
- Monthly CareBridge amounts are multiplied by 12.
- Annual CareBridge amounts are used as supplied.
- Negative amounts or unsupported billing frequencies block publication.

### Top 8 probability

The eight strategic deals use the VP readiness scorecard rather than Salesforce stage probability.

```text
GPA = 20% Leadership + 20% Commercial + 60% Contractual

GPA >= 3.20             -> 75%
GPA >= 2.40 and < 3.20  -> 50%
GPA >= 1.60 and < 2.40  -> 30%
GPA < 1.60              -> 10%
```

Each score must be a whole number from 1 through 4. The rule-derived probability controls even when the workbook contains a different probability; that disagreement is audited.

### Longtail probability

Longtail deals use the valid probability supplied by their source. Any numeric value from 0 through 1 is accepted. The pipeline does not force every stage to have a predefined probability.

### Expected value

```text
Expected value = annual ACV x active probability
```

Closed Lost records are excluded from the active forecast. Their probability is not rewritten because it cannot affect the forecast.

The official reporting date is fixed at October 15, 2026 for this exercise. Fiscal period and stage determine Q4 eligibility. A stale or unparseable close date creates an audit warning but does not silently remove an otherwise eligible deal.

## 6. Identifier and name matching

Salesforce supplies both 15-character and 18-character IDs. The pipeline preserves the original ID and uses the first 15 characters as the exact, case-sensitive matching key. This allows the prior-week file and scorecard to join to the current export without fuzzy ID matching.

Names are normalized for capitalization, punctuation, and repeated spaces. A missing scorecard ID is filled automatically only when exactly one current Salesforce record matches the normalized hospital, product, and sales representative.

If there is no unique exact match, the pipeline ranks candidates with the same product and representative by hospital-name similarity. Similarity is only a search aid; it never makes the decision.

### How `name_similarity` is calculated

Before comparison, each hospital name is converted to lowercase, punctuation is removed, and consecutive spacing is collapsed. For example:

```text
"Ironwood Clinical Center & Health System"
-> "ironwood clinical center health system"
```

The normalized scorecard name and Salesforce name are compared with Python's `difflib.SequenceMatcher`. It finds matching character sequences and returns a ratio from `0` to `1`, calculated conceptually as:

```text
2 x matching characters / total characters across both names
```

The pipeline rounds the ratio to three decimal places. A value such as `0.618` means the normalized strings have moderate textual similarity; it does not mean there is a 61.8% probability that they represent the same hospital.

Candidate generation first requires the product and sales representative to match. `name_similarity` then controls only the display order of those candidates. There is no similarity threshold that automatically accepts a candidate.

## 7. Duplicate handling

Duplicates are evaluated after standardization so monthly and annual representations can be compared fairly.

- **Exact same-source copies:** keep one calculation record and audit the removal.
- **Same identity, different valid values:** use the lowest expected-value row as the conservative baseline and preserve each distinct variant.
- **Same ID, different identity:** block because the pipeline cannot know which customer, product, or owner is correct.
- **Equivalent Salesforce and CareBridge deal:** count once and retain Salesforce as the calculation record.
- **Strong cross-source match with material value conflict:** block and show both records.

A human can permanently select an authoritative same-source variant through `duplicate_selections` in `resolutions.json`.

## 8. Human resolutions

`config/resolutions.json` is an input, not a machine-generated report. It keeps a human decision reproducible across complete pipeline reruns.

It supports three actions:

1. `scorecard_mappings` maps a blank-ID Excel source row to the confirmed Salesforce opportunity and records a reason. Using the row rather than hospital name allows multiple deals for the same hospital.
2. `duplicate_selections` confirms one authoritative row from a reported conflict.
3. `record_overrides` supplies a confirmed correction to an allowed CSV field, with a reason.

The pipeline validates every resolution against the current source data. A missing target, disallowed field, ambiguous row, missing reason, or outdated mapping blocks publication. This is deliberate: silently ignoring a stale decision could produce a forecast that looks valid but no longer reflects the human's intent.

`review.json` has one unified `issues` list. An unresolved scorecard mapping appears there once, with its source row and ranked candidates. There is no separate scorecard-review collection containing the same evidence. Automatically and manually resolved mappings appear in `forecast.json` under `audit_log`.

The resolution file is cumulative. A rerun applies all active decisions and regenerates the review and forecast from the source files. The root `README.md` contains copyable examples for each resolution type.

## 9. Week-over-week comparison

The current and prior Salesforce exports are standardized and deduplicated before comparison. Deals are joined using the canonical Salesforce ID.

The output reports:

- records present now but absent previously;
- Q4 deals that slipped to Q1;
- deals that became Closed Lost;
- movements between ordered open stages; and
- increases or decreases in annual ACV.

A new deal is reported as new regardless of its current stage or fiscal period. This keeps “new to the file” separate from “eligible for the active forecast.”

## 10. Audit trail and dashboard behavior

The audit log records the source, source rows, record ID, original value, resulting value, action, resolution source, and forecast impact where applicable.

The dashboard has two distinct modes:

- The **validated baseline** is the output of the pipeline.
- A **what-if scenario** exists only in the current browser session.

In the Deal Room, a Top 8 deal uses scorecard probability and a longtail deal uses source-stage probability. Changing readiness scores immediately recalculates probability and expected value because expected value is derived from probability. The adjacent button switches probability models; it is not an Apply or Save button.

Resetting or refreshing the application restores the validated baseline. The dashboard cannot write to raw files, resolutions, or published JSON.

## 11. Testing approach

`docs/TESTS.md` is the behavioral contract. Every scenario has a stable `Txx` identifier that also appears in its pytest name.

The tests use a small committed baseline containing all four real file formats. Scenario definitions deliberately change that baseline to create exact duplicates, conflicting duplicates, invalid values, missing mappings, warnings, weekly movements, and valid or invalid resolutions. Each test runs against an isolated copy so it cannot alter the committed fixtures.

The suite checks the important business outcomes rather than attempting every mathematical combination. Its main question is whether each representative condition is accepted, audited, or blocked exactly as specified.

At finalization, all 50 tests covering scenarios T01 through T38 pass. A new rule should receive a new scenario ID and a corresponding automated test.

## 12. Recorded UI incident

An earlier Deal Room bug assigned generic `3/3/3` scores when an original Top 8 deal was switched to stage probability and then returned to the scorecard model. That overwrote the deal's original scores in the browser and produced an incorrect scenario change.

The correction distinguishes between:

- giving temporary default scores to an original longtail deal entering Top 8; and
- restoring the authoritative scores of an original Top 8 deal.

For Aethelgard Health System, the validated `4/4/3` scorecard now returns to 75% probability and the original expected value after switching models.

## 13. Design decisions and tradeoffs

### Preserve evidence instead of editing exports

Raw exports remain unchanged, while corrections live in a separate resolution file. This provides traceability and makes reruns reproducible. The cost is that users must understand the difference between source data and a resolution.

### Rebuild instead of patching

Every run recalculates the full result. With four small files this is simpler and safer than maintaining incremental state. It also proves that the forecast can be reconstructed solely from inputs and confirmed decisions.

### Prefer deterministic rules over guesses

Exact duplicates and written probability rules are safe to automate. Identity conflicts and ambiguous scorecard mappings require a human. This creates more visible review work but avoids silently turning a plausible guess into an official number.

### Publish a bounded duplicate variant

For one identity-consistent conflict, the system publishes the lowest valid expected value and exposes the alternatives. This keeps the forecast usable while clearly bounding uncertainty. The tradeoff is that the baseline is conservative, not necessarily the eventual authoritative answer.

### Keep the resolution interface file-based

JSON is reviewable, versionable, and requires no server. It is appropriate for this exercise but less friendly than a governed approval screen. The dashboard therefore shows evidence but cannot submit decisions.

### Recommend a Python virtual environment

The documented setup uses a local `.venv` so the pipeline and tests use the dependency versions installed for this project rather than unrelated packages from the computer's global Python installation. This reduces version conflicts, avoids modifying system Python, and makes another person's setup more reproducible from `requirements.txt`.

The virtual environment is a recommended setup, not a pipeline requirement. The code does not check for a `.venv` directory or refuse to run without one. A user may instead use Conda, Poetry, Docker, or another isolated environment. The decision is to require the declared dependencies while allowing the user to choose how those dependencies are isolated.

### Separate official and exploratory calculations

Browser scenarios help users understand sensitivity without changing the audited forecast. The tradeoff is that scenarios disappear on refresh and cannot be shared as saved versions.

### Warn on close dates, rely on fiscal classification

Fiscal period and stage control eligibility. Close-date problems remain visible warnings rather than silently changing the forecast population. This respects the explicit source classification but means an operator should still follow up on date hygiene.

## 14. Future production direction

### File checksums and ingestion manifests

A checksum is a short fingerprint calculated from file contents. Identical files produce the same checksum; even a small content change produces a different one. This project does not currently create a file-checksum manifest.

In production, each ingestion should record the filename, SHA-256 checksum, reporting date, row count, source system, ingestion time, and pipeline version. This would detect accidental reprocessing, prove which exact export created a forecast, and support historical reproduction.

The final three characters of an 18-character Salesforce ID are also commonly called a checksum suffix. They make the 15-character ID safe for case-insensitive environments. The current pipeline joins on the original case-sensitive 15-character portion because some supplied sources do not have the suffix. A production validator could verify the full 18-character form when it is available.

### Upserts

An **upsert** means “insert this record if it is new; otherwise update the existing record identified by its key.” The current file-based pipeline does not need upserts because it rebuilds complete JSON outputs.

With a database, upserts would make ingestion repeatable without creating duplicate rows. The key should include `source_system`, `source_deal_id`, and `snapshot_date`; using only the deal ID would overwrite history. Raw snapshots and forecast runs should remain immutable even when the current normalized representation is updated.

### SQL database

A SQL database becomes useful when the system needs scheduled weekly ingestion, many historical snapshots, concurrent users, saved resolutions, approvals, or dashboard queries across time.

A production model could separate:

- source snapshots and ingestion manifests;
- canonical deals and source identifiers;
- dated deal states;
- scorecards;
- human resolutions and approvals;
- forecast runs; and
- append-only audit events.

CSV and Excel originals would normally stay in encrypted object storage, while SQL stores structured records and references to those files. The database would add migrations, access control, backup, and operational overhead, so it is unnecessary for the present take-home workflow.

### Governed resolution workflow

The next usability improvement would be an authenticated resolution screen that writes through an API, records who approved a change, validates it, reruns the pipeline, and shows the resulting audit event. Role-based access and an approval history are necessary before allowing browser writes.

### Additional data hygiene

Useful extensions include:

- validating or deriving stage tenure from a stage-change timestamp;
- separating canonical hospital names from AKA/FKA aliases;
- parameterizing the reporting date and board target;
- recording source snapshot dates;
- validating Salesforce 18-character checksum suffixes;
- monitoring stale resolutions across weekly snapshots; and
- alerting when a scheduled run is blocked or a forecast becomes stale.

### Operational reliability

Production publication should use a run ID, transactional database commit or versioned object, automated retention, observability, and an explicit “current approved forecast” pointer. This extends the same safety property already used here: a failed run must never replace the last valid forecast.

## 15. Glossary

- **ACV:** Annual Contract Value.
- **Audit:** A nonblocking record of a transformation, warning, or confirmed decision.
- **Baseline:** The official forecast published by the pipeline.
- **Blocker:** A condition that prevents publication of a new forecast.
- **Canonical ID:** A normalized identifier used to join representations of the same deal.
- **Checksum:** A content-derived fingerprint used to detect changes or verify identity.
- **Resolution:** A confirmed human instruction applied during a pipeline run.
- **Snapshot:** The state of source data or a published forecast at a particular time.
- **Upsert:** Insert a new database record or update the existing record with the same key.
