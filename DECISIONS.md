# PulseFlow Health Project Decisions

> **Historical planning artifact:** this file contains early design exploration, including approaches that were later replaced. See [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md) for the finalized decisions and tradeoffs.

## Purpose

This document explains why we make important product and engineering decisions. It records alternatives and tradeoffs without repeating the implementation checklist in `PLAN.md`.

Use the documents as follows:

- `PLAN.md`: what we intend to build and how we will verify it.
- `DECISIONS.md`: why we chose an approach, what alternatives we considered, and what remains undecided.
- Final `README.md`: how a reviewer installs, runs, refreshes, and evaluates the completed project.

Update this document when a decision changes the correctness, scope, user experience, or architecture of the project. Do not use it as a daily activity log.

## Current Principles

### Preserve raw evidence

The pipeline will not edit the supplied CSV or XLSX files. It will preserve original identifiers and source-row references, then create normalized outputs. This allows every calculated value and correction to be traced back to the source.

The VP scorecard will be read directly as XLSX. Converting it to CSV would create another copy without improving the Rule 2 workflow and could discard workbook context useful for audit review.

### Automate facts and expose judgment

The pipeline may automatically normalize known formats and remove provably identical duplicates. It must not guess which conflicting business record is correct when the source lacks enough evidence. Those cases require an explicit human decision.

Human judgment is appropriate only when the available evidence does not determine a correct answer. When the challenge specification defines an exact rule, that written rule controls the official baseline even if a raw source cell or note disagrees. The pipeline still exposes the disagreement for human review.

### Correctness before presentation

The executive dashboard is valuable only if its forecast is trustworthy. Data validation, reconciliation, deterministic calculations, and auditability therefore come before frontend polish.

### Clean once, classify afterward

Each raw source is parsed, validated, normalized, and deduplicated once. Forecast buckets such as Top 8 and longtail are later classifications of the same clean records. This prevents duplicated cleaning logic, conflicting resolutions, and different versions of one opportunity appearing in separate calculations.

### Use explicit fiscal period for Q4 eligibility

Salesforce `Fiscal_Period` and an allowed open stage determine active Q4 eligibility. Close dates provide validation evidence but do not silently reclassify a deal. A valid open Q4 deal with a past-due, missing, or inconsistent close date remains included and receives a nonblocking audit warning; an unknown fiscal period or stage is blocking because eligibility cannot be established.

## Decision: One Project Plan

We will maintain one project-level `PLAN.md` rather than separate plans for every rule or subsystem. The project is small enough that multiple plan files would create unnecessary navigation and synchronization work.

Detailed supporting documents should be added only when they serve a distinct purpose. This decision record is separate because rationale and tradeoffs would make the implementation plan harder to scan.

## Decision: Match Scorecard IDs Through the Salesforce 15-Character Form

The VP scorecard contains some 15-character Salesforce IDs, while the current Salesforce CSV contains 18-character IDs. For this specific join, the three-character Salesforce checksum cannot participate because the scorecard does not contain it.

The pipeline will preserve the full source ID and derive the first 15 characters as a canonical matching key. Matching remains exact and case-sensitive. Fuzzy matching is not allowed when both files provide IDs that disagree.

### Tradeoff

Requiring 18-character IDs in every scorecard row would be safer, but the pipeline must process the supplied files as they exist. A future source-template improvement should require a valid 18-character ID for every Top 8 row.

## Decision: Treat Repeated Records According to Evidence

- One record is accepted normally.
- Identical repeated rows are deduplicated automatically and recorded in the audit log.
- Conflicting rows for one opportunity are quarantined and excluded until a human resolves them.
- Conflicting rows are never summed, averaged, or treated as separate opportunities.

### Tradeoff

Automatically selecting the last, largest, most advanced, or most conservative record would produce a usable number faster, but the source provides no update timestamp or rule proving that choice is correct. Quarantine favors trust over convenience.

## Decision: Block Official Totals While Top 8 Conflicts Remain

Clean outputs may still be generated for unaffected deals, but the system will not present an official Top 8 expected value or total Q4 forecast while a blocking Top 8 conflict is unresolved. A partial subtotal may be shown only when clearly labeled as incomplete.

### Tradeoff

Publishing a provisional total would keep the meeting moving, but it could be repeated or copied as if it were complete. Blocking the official total makes the missing decision explicit.

## Decision: Use Human Resolutions as Inputs, Not Automatic Pipeline Decisions

The initial design uses a human-authored `resolutions.yaml` file. A human verifies the authoritative source record, selects one candidate, and records a reason. The pipeline validates and applies that instruction on the next run.

### Alternatives considered

- CLI prompt: convenient during a manual run but harder to automate and reproduce.
- Frontend selection: easiest for business users but requires authenticated write APIs, persistence, error handling, and pipeline orchestration.
- Deterministic default: simplest to code but makes an unsupported business assumption.

The YAML approach is the smallest repeatable workflow for v1. Frontend resolution may be reconsidered after the required dashboard and pipeline are complete.

## Decision: Missing Scorecard IDs Require Explicit ID Mapping

When a scorecard row has no Salesforce ID, the pipeline creates a short review list by filtering for exact product and sales-representative matches and ordering the remaining candidates by simple hospital-name similarity. This automation helps the human find the likely record quickly but never creates an accepted match.

The human must map the scorecard row to one Salesforce opportunity ID in `resolutions.yaml`. The pipeline validates that the selected opportunity exists and that product and representative match exactly. The final status remains binary: `confirmed` or `unresolved_mismatch`.

Hospital similarity is displayed as supporting context only. The design does not maintain normalization, alias, or confidence classifications. Rejecting a candidate without providing the correct opportunity ID leaves the row unresolved and continues blocking the official Top 8 result.

### Tradeoff

Automatic name matching would reduce manual work but could turn a plausible hospital name into an unsupported fact. Explicit ID mapping retains human judgment while the candidate list keeps the work quick and simple.

For the supplied dataset, the initial mappings have been confirmed as Ironwood to `006PF000001T005YAC`, Borealis to `006PF000001T006YAC`, Starlight to `006PF000001T007YAC`, and Halcyon to `006PF000001T008YAC`. These will seed the first resolution file while remaining subject to pipeline validation.

## Decision: Keep Human Inputs and Machine Outputs Separate

- `resolutions.yaml` is a human-authored instruction.
- `data/work/review_required.json` is the operator-only report for unresolved blocking issues and suggested candidates.
- `data/processed/dashboard_snapshot.json` is the finalized input consumed by the executive web application.

Every pipeline run rebuilds its output from the raw inputs and resolution file. Blocking runs update only the review report; successful runs atomically replace the complete dashboard snapshot. YAML remains limited to small, readable human instructions.

## Decision: Retain Immutable Raw Input Snapshots

The v1 pipeline stores every weekly CSV and XLSX input unchanged in a reporting-date folder and stores processed outputs separately. A manifest records source filenames, checksums, row counts, reporting date, and pipeline version so an old forecast can be reproduced and audited.

The system should not depend on downloading an old export again from Salesforce, HubSpot, or another source. Records, permissions, and export behavior can change, so a later export may not reproduce the data originally processed.

### Production-scale direction

At production scale, immutable raw files belong in object storage such as Amazon S3, Google Cloud Storage, or Azure Blob Storage rather than as file blobs in a relational database. A database or warehouse stores normalized deal records, forecasts, resolution decisions, audit metadata, and references to the raw objects.

Raw retention must follow an explicit lifecycle policy with encryption, access control, and deletion or archival periods appropriate to the data. The v1 dated-folder design mirrors this future raw-zone pattern without requiring cloud infrastructure.

## Decision: Review Evidence in the Web App, Resolve Through Configuration

The Data Hygiene & Audit Log tab is the v1 human-review surface. It displays missing-ID scorecard candidates and conflicting duplicate rows with source evidence, differing fields, financial effect, status, and resolution history.

The tab is read-only. A human records the authoritative ID or row in `resolutions.yaml`, reruns the pipeline, and refreshes the application. This keeps the business evidence easy to inspect without adding authenticated write APIs and pipeline orchestration to v1.

## Decision: Recalculate Scorecard Probabilities From the Written Rule

The challenge specification defines the score weights and GPA-to-probability thresholds. The pipeline will calculate these values rather than trusting cached or manually overwritten workbook probabilities.

If the workbook probability conflicts with the rule-derived result, the rule-derived probability controls the forecast and the disagreement appears as a nonblocking audit item. The audit evidence includes the scores, calculated GPA, observed and required probabilities, VP note, and expected-value difference so a human can double-check the automatic correction.

The human may model the overridden value as a temporary what-if scenario, but cannot replace the official baseline probability. This keeps the result deterministic while making the source conflict visible.

## Decision: Block Top 8 Records That Cannot Be Corrected Deterministically

The pipeline quarantines a Top 8 record when its scores are invalid, its mapped opportunity is not active in Q4-2026, the same opportunity is mapped to multiple scorecard rows, or its Salesforce ACV is missing, invalid, negative, or unexpectedly non-annual.

These conditions cannot be repaired from the supplied evidence. Imputing values, counting a deal twice, changing its fiscal status, or silently converting an unexpected Salesforce amount would introduce unsupported assumptions. The official Top 8 result remains blocked until a human corrects the source or supplies a valid resolution.

## Terms

- **ACV:** Annual Contract Value, the value of a subscription over 12 months.
- **Scorecard:** The VP Excel input that identifies and scores the eight strategic deals.
- **Canonical ID:** The normalized identifier used for matching while the original source ID remains preserved.
- **Quarantine:** Preserve a problematic record but exclude it from official calculations until resolved.
- **Resolution:** An explicit human instruction selecting the authoritative candidate and explaining why.
- **Audit log:** A machine-generated record of detected issues, pipeline actions, and resolution outcomes.

## Open Questions

- Whether the completed frontend should display unresolved conflicts only or eventually allow authorized users to resolve them.
- How nonblocking warnings will differ from errors that block the official forecast.
- How long resolution decisions remain valid when a later weekly snapshot changes the candidate records.

These questions remain open until their relevant part of `PLAN.md` is reviewed.
