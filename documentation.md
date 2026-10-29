# Implementation Notes

> **Archived incident note:** this issue and its final behavior are incorporated into [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md). The test-count statement below reflects the time of the original fix, not the finalized 47-test suite.

## Deal Room score restoration bug

### Symptom

In the Deal Room, Aethelgard Health System initially showed a `$0` what-if change against the validated baseline. Switching it from **Top 8 scorecard** to **stage probability** correctly changed the forecast by `+$120,000`. Switching it back to the Top 8 scorecard then incorrectly showed `-$600,000` instead of returning to `$0`.

### Root cause

The bucket-toggle logic treated these two actions as the same case:

1. Promoting an original longtail deal into Top 8 for the first time.
2. Returning an original Top 8 deal to Top 8 after temporarily switching it to stage probability.

Original longtail deals do not have Top 8 scores, so the interface assigns them temporary default scores of `3/3/3` for scenario modeling. The bug was that those same defaults were also assigned to Aethelgard when it returned to Top 8, overwriting its original `4/4/3` scorecard within the browser session.

This produced the incorrect calculation:

- Validated scorecard: `4/4/3` → GPA `3.40` → probability `75%`
- Validated expected value: `$2,400,000 × 75% = $1,800,000`
- Accidental default: `3/3/3` → GPA `3.00` → probability `50%`
- Incorrect expected value: `$2,400,000 × 50% = $1,200,000`
- Incorrect scenario impact: `$1,200,000 − $1,800,000 = -$600,000`

### Fix

The toggle now checks the deal's original forecast bucket:

- If the deal originally belonged to Top 8, switching it back restores and retains its original scorecard.
- Temporary `3/3/3` scores are created only when a deal that originally belonged to longtail is moved into Top 8.

The controls were also renamed from **Promote/Demote** to **Use Top 8 scorecard/Use stage probability** to state exactly which probability model the scenario uses.

### Verified behavior

For Aethelgard, the scenario now behaves as follows:

1. Top 8 scorecard baseline: `$0` change.
2. Use stage probability: `+$120,000` change because the Salesforce stage probability is `80%` rather than the scorecard's `75%`.
3. Return to Top 8 scorecard: `$0` change, with the original `4/4/3` scores restored.

The frontend production build succeeds, and all 15 pipeline tests pass.
