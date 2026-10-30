import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Tab = "overview" | "deals" | "movement" | "audit";
type Bucket = "top_8" | "salesforce_longtail" | "carebridge_longtail";

interface Top8Scores {
  leadership: number;
  commercial: number;
  contractual: number;
  composite_gpa: number;
}

interface Deal {
  opportunity_id: string;
  canonical_id: string;
  source: "salesforce" | "carebridge";
  source_row: number;
  health_system: string;
  product: string;
  sales_rep: string;
  region: string | null;
  fiscal_period: string;
  stage: string;
  stage_probability: number;
  close_date: string;
  original_amount: number;
  billing_frequency: string;
  annual_acv: number;
  forecast_bucket: Bucket;
  top_8_scores: Top8Scores | null;
  vp_notes: string | null;
  probability: number;
  expected_value: number;
  source_conflict: null;
}

interface ScenarioDeal extends Deal {
  scenario_bucket: Bucket;
  scenario_scores: Top8Scores | null;
  scenario_probability: number;
  scenario_expected_value: number;
}

interface AuditEntry {
  audit_id: string;
  type: string;
  status: "automatically_resolved" | "human_resolved" | "warning";
  source: string;
  source_rows: number[];
  record_id: string | null;
  original_value: unknown;
  resulting_value: unknown;
  action: string;
  resolution_source: string;
  forecast_impact: unknown;
}

interface MovementItem {
  opportunity_id: string;
  health_system: string;
  product: string;
  sales_rep: string;
  [key: string]: string | number;
}

interface ForecastData {
  schema_version: number;
  reporting_date: string;
  generated_at: string;
  board_target: number;
  summary: {
    total_expected_sales: number;
    top_8_expected_value: number;
    salesforce_longtail_expected_value: number;
    carebridge_longtail_expected_value: number;
    variance_to_target: number;
    baseline_status: string;
  };
  deals: Deal[];
  week_over_week: Record<string, MovementItem[]>;
  audit_log: AuditEntry[];
}

interface ReviewIssue {
  issue_id: string;
  type: string;
  status: "blocking";
  source: string;
  source_rows: number[];
  record_id: string | null;
  message: string;
  evidence: unknown;
  required_action: string;
}

interface ReviewData {
  schema_version: number;
  reporting_date: string;
  generated_at: string;
  status: "clear" | "blocked";
  blocking_issue_count: number;
  issues: ReviewIssue[];
}

interface ScorecardMapping {
  source_row: number;
  opportunity_id: string;
  reason: string;
}

interface DuplicateSelection {
  source: string;
  opportunity_id: string;
  selected_source_row: number;
  reason: string;
}

interface RecordOverride {
  source: string;
  source_row?: number;
  record_id: string;
  field: string;
  value: string;
  reason: string;
}

interface ResolutionsData {
  scorecard_mappings: ScorecardMapping[];
  duplicate_selections: DuplicateSelection[];
  record_overrides: RecordOverride[];
}

interface ResolutionDraft {
  opportunityId?: string;
  selectedRow?: string;
  field?: string;
  value?: string;
  reason?: string;
}

const emptyResolutions = (): ResolutionsData => ({
  scorecard_mappings: [],
  duplicate_selections: [],
  record_overrides: [],
});

const overrideFields = [
  "Fiscal_Period",
  "Health_System",
  "Company_Name",
  "Product",
  "Stage",
  "Deal_Stage",
  "Stage_Probability",
  "Amount",
  "Billing_Frequency",
  "Close_Date",
  "Expected_Close_Date",
  "Sales_Rep",
  "AE_Owner",
  "Days_In_Stage",
];

const movementLabels: Record<string, string> = {
  new_deals: "New deals",
  slipped_deals: "Slipped to Q1",
  closed_lost_deals: "Closed lost",
  stage_moves: "Stage moves",
  acv_changes: "ACV changes",
};

const bucketLabels: Record<Bucket, string> = {
  top_8: "Top 8 strategic",
  salesforce_longtail: "Salesforce longtail",
  carebridge_longtail: "CareBridge longtail",
};

const bucketColors: Record<Bucket, string> = {
  top_8: "#173b5e",
  salesforce_longtail: "#2f8090",
  carebridge_longtail: "#d79a4a",
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const compactMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
});

function probabilityForScores(leadership: number, commercial: number, contractual: number) {
  const gpa = Math.round((0.2 * leadership + 0.2 * commercial + 0.6 * contractual) * 100) / 100;
  const probability = gpa >= 3.2 ? 0.75 : gpa >= 2.4 ? 0.5 : gpa >= 1.6 ? 0.3 : 0.1;
  return { gpa, probability };
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );
}

function impactValue(value: unknown): string {
  if (typeof value === "number") return money.format(value);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (typeof object.difference === "number") return `${money.format(object.difference)} range`;
    if (typeof object.baseline === "number") return `${money.format(object.baseline)} baseline`;
  }
  return "—";
}

function movementDetail(item: MovementItem, category: string) {
  switch (category) {
    case "new_deals":
      return `${item.fiscal_period} · ${item.stage}`;
    case "slipped_deals":
      return `${item.prior_fiscal_period} → ${item.current_fiscal_period}`;
    case "closed_lost_deals":
      return `${item.prior_stage} → Closed Lost`;
    case "stage_moves":
      return `${item.prior_stage} → ${item.current_stage}`;
    case "acv_changes":
      return `${money.format(Number(item.prior_annual_acv))} → ${money.format(Number(item.current_annual_acv))}`;
    default:
      return "";
  }
}

function movementValue(item: MovementItem, category: string) {
  if (category === "stage_moves") return money.format(Number(item.expected_value_change));
  if (category === "acv_changes") return money.format(Number(item.change));
  return money.format(Number(item.annual_acv));
}

function LoadingState() {
  return (
    <main className="state-page">
      <div className="pulse-mark" aria-hidden="true"><span /></div>
      <p className="eyebrow">PulseFlow Health</p>
      <h1>Preparing the forecast</h1>
      <p>Loading the validated pipeline snapshot…</p>
    </main>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <main className="state-page error-state">
      <div className="state-icon">!</div>
      <p className="eyebrow">Forecast unavailable</p>
      <h1>The generated data could not be loaded</h1>
      <p>{message}</p>
      <code>python3 pipeline/process_data.py</code>
    </main>
  );
}

function parseResolutions(value: unknown): ResolutionsData {
  if (!value || typeof value !== "object") throw new Error("The file must contain a JSON object.");
  const object = value as Record<string, unknown>;
  for (const key of ["scorecard_mappings", "duplicate_selections", "record_overrides"]) {
    if (!Array.isArray(object[key])) throw new Error(`${key} must be a JSON array.`);
  }
  return {
    scorecard_mappings: object.scorecard_mappings as ScorecardMapping[],
    duplicate_selections: object.duplicate_selections as DuplicateSelection[],
    record_overrides: object.record_overrides as RecordOverride[],
  };
}

function evidenceObject(issue: ReviewIssue): Record<string, unknown> {
  return issue.evidence && typeof issue.evidence === "object" && !Array.isArray(issue.evidence)
    ? issue.evidence as Record<string, unknown>
    : {};
}

function candidateOptions(issue: ReviewIssue): { opportunity_id: string; hospital: string; product: string; sales_rep: string; name_similarity: number }[] {
  const candidates = evidenceObject(issue).candidates;
  return Array.isArray(candidates) ? candidates as ReturnType<typeof candidateOptions> : [];
}

function suggestedOverrideFields(issue: ReviewIssue): string[] {
  const message = issue.message.toLowerCase();
  const matches: string[] = [];
  const add = (field: string, ...phrases: string[]) => {
    if (phrases.some((phrase) => message.includes(phrase))) matches.push(field);
  };
  add("Amount", "amount");
  add("Stage_Probability", "stage_probability");
  add("Billing_Frequency", "billing_frequency", "billing frequency");
  add("Fiscal_Period", "fiscal_period");
  add("Stage", "salesforce stage");
  add("Deal_Stage", "deal_stage");
  return [...new Set(matches)].filter((field) => overrideFields.includes(field));
}

function issueKind(issue: ReviewIssue): "mapping" | "override" | "duplicate" | "remove" | "source" {
  if (issue.type === "missing_scorecard_id" && candidateOptions(issue).length) return "mapping";
  if (["invalid_salesforce_record", "invalid_carebridge_record"].includes(issue.type) && issue.record_id && suggestedOverrideFields(issue).length) return "override";
  if (issue.type === "conflicting_duplicate" && issue.record_id && issue.source_rows.length) return "duplicate";
  if ([
    "invalid_resolution",
    "invalid_record_override",
    "invalid_duplicate_resolution",
    "stale_record_override",
    "stale_duplicate_resolution",
    "invalid_scorecard_mapping",
    "stale_scorecard_mapping",
  ].includes(issue.type)) return "remove";
  return "source";
}

function resolutionCount(resolutions: ResolutionsData) {
  return resolutions.scorecard_mappings.length + resolutions.duplicate_selections.length + resolutions.record_overrides.length;
}

function ReviewPage({ review }: { review: ReviewData }) {
  const [resolutions, setResolutions] = useState<ResolutionsData>(emptyResolutions());
  const [drafts, setDrafts] = useState<Record<string, ResolutionDraft>>({});
  const [removedIssues, setRemovedIssues] = useState<Set<string>>(new Set());
  const [resolutionStatus, setResolutionStatus] = useState("Loading the existing resolutions…");
  const [resolutionError, setResolutionError] = useState("");

  useEffect(() => {
    fetch("/resolutions.json")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((value) => {
        const parsed = parseResolutions(value);
        setResolutions(parsed);
        setResolutionStatus(`Loaded ${resolutionCount(parsed)} existing decision${resolutionCount(parsed) === 1 ? "" : "s"}`);
      })
      .catch((error: Error) => {
        setResolutionError(`Could not load the existing resolutions.json (${error.message}). Choose the file below before downloading.`);
        setResolutionStatus("Existing resolutions not loaded");
      });
  }, []);

  const updateDraft = (issueId: string, change: Partial<ResolutionDraft>) => {
    setDrafts((current) => ({ ...current, [issueId]: { ...current[issueId], ...change } }));
  };

  const loadResolutionFile = (file?: File) => {
    if (!file) return;
    file.text()
      .then((text) => parseResolutions(JSON.parse(text)))
      .then((parsed) => {
        setResolutions(parsed);
        setResolutionError("");
        setResolutionStatus(`Loaded ${resolutionCount(parsed)} existing decision${resolutionCount(parsed) === 1 ? "" : "s"} from ${file.name}`);
      })
      .catch((error: Error) => setResolutionError(`That file could not be used: ${error.message}`));
  };

  const draftIsComplete = (issue: ReviewIssue) => {
    const draft = drafts[issue.issue_id] ?? {};
    const kind = issueKind(issue);
    if (kind === "mapping") return Boolean(draft.opportunityId && draft.reason?.trim());
    if (kind === "override") return Boolean(draft.field && draft.value !== undefined && draft.value !== "" && draft.reason?.trim());
    if (kind === "duplicate") return Boolean(draft.selectedRow && draft.reason?.trim());
    return kind === "remove" && removedIssues.has(issue.issue_id);
  };

  const completedIssues = review.issues.filter(draftIsComplete);

  const buildDownload = () => {
    let next: ResolutionsData = {
      scorecard_mappings: [...resolutions.scorecard_mappings],
      duplicate_selections: [...resolutions.duplicate_selections],
      record_overrides: [...resolutions.record_overrides],
    };

    for (const issue of review.issues) {
      const kind = issueKind(issue);
      const draft = drafts[issue.issue_id] ?? {};
      if (kind === "remove" && removedIssues.has(issue.issue_id)) {
        const rawEvidence = evidenceObject(issue);
        const target = rawEvidence.override && typeof rawEvidence.override === "object" ? rawEvidence.override : issue.evidence;
        const targetJson = JSON.stringify(target);
        next = {
          scorecard_mappings: next.scorecard_mappings.filter((item) => JSON.stringify(item) !== targetJson),
          duplicate_selections: next.duplicate_selections.filter((item) => JSON.stringify(item) !== targetJson),
          record_overrides: next.record_overrides.filter((item) => JSON.stringify(item) !== targetJson),
        };
      }
      if (!draftIsComplete(issue)) continue;
      if (kind === "mapping") {
        const mapping: ScorecardMapping = {
          source_row: issue.source_rows[0],
          opportunity_id: draft.opportunityId!,
          reason: draft.reason!.trim(),
        };
        next.scorecard_mappings = [...next.scorecard_mappings.filter((item) => item.source_row !== mapping.source_row), mapping];
      }
      if (kind === "override") {
        const override: RecordOverride = {
          source: issue.source,
          record_id: issue.record_id!,
          field: draft.field!,
          value: draft.value!,
          reason: draft.reason!.trim(),
          ...(issue.source_rows.length === 1 ? { source_row: issue.source_rows[0] } : {}),
        };
        next.record_overrides = [
          ...next.record_overrides.filter((item) => !(
            item.source === override.source && item.record_id === override.record_id && item.field === override.field && item.source_row === override.source_row
          )),
          override,
        ];
      }
      if (kind === "duplicate") {
        const selection: DuplicateSelection = {
          source: issue.source,
          opportunity_id: issue.record_id!,
          selected_source_row: Number(draft.selectedRow),
          reason: draft.reason!.trim(),
        };
        next.duplicate_selections = [
          ...next.duplicate_selections.filter((item) => !(
            item.source === selection.source && item.opportunity_id === selection.opportunity_id
          )),
          selection,
        ];
      }
    }

    const blob = new Blob([`${JSON.stringify(next, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "resolutions.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="review-page">
      <header className="review-header">
        <div className="review-brand"><span className="review-brand-mark">P</span><strong>PulseFlow pipeline review</strong></div>
        <span className="blocked-pill"><i /> Forecast blocked</span>
      </header>
      <section className="review-intro">
        <p className="eyebrow">Human review required</p>
        <h1>{review.blocking_issue_count} {review.blocking_issue_count === 1 ? "issue is" : "issues are"} preventing a new forecast</h1>
        <p>The previous forecast has not been replaced. Review each item below, create the supported decisions, then replace <code>config/resolutions.json</code> and rerun the pipeline.</p>
      </section>

      <div className="review-layout">
        <section className="review-issues" aria-label="Blocking issues">
          {review.issues.map((issue, index) => {
            const kind = issueKind(issue);
            const draft = drafts[issue.issue_id] ?? {};
            const candidates = candidateOptions(issue);
            const availableFields = suggestedOverrideFields(issue);
            return (
              <article className="review-card" key={issue.issue_id}>
                <div className="review-card-number">{index + 1}</div>
                <div className="review-card-body">
                  <div className="review-card-top">
                    <div><p className="card-label">{titleCase(issue.type)}</p><h2>{issue.message}</h2></div>
                    <span className={kind === "source" ? "fix-badge source" : "fix-badge resolution"}>{kind === "source" ? "Source file" : "Resolution file"}</span>
                  </div>
                  <dl className="issue-location">
                    <div><dt>File</dt><dd>{issue.source}</dd></div>
                    <div><dt>Row</dt><dd>{issue.source_rows.join(", ") || "File-level"}</dd></div>
                    <div><dt>Record</dt><dd>{issue.record_id || "—"}</dd></div>
                  </dl>
                  <p className="required-action"><strong>What to do:</strong> {issue.required_action}</p>

                  {kind === "mapping" && (
                    <div className="resolution-form">
                      <label>Confirmed Salesforce opportunity
                        <select value={draft.opportunityId ?? ""} onChange={(event) => updateDraft(issue.issue_id, { opportunityId: event.target.value })}>
                          <option value="">Choose a suggested match…</option>
                          {candidates.map((candidate) => <option key={candidate.opportunity_id} value={candidate.opportunity_id}>{candidate.hospital} · {candidate.product} · {candidate.sales_rep} ({Math.round(candidate.name_similarity * 100)}% name match)</option>)}
                        </select>
                      </label>
                      <label>Reason for the decision<input value={draft.reason ?? ""} onChange={(event) => updateDraft(issue.issue_id, { reason: event.target.value })} placeholder="Example: Confirmed with the sales representative" /></label>
                    </div>
                  )}

                  {kind === "override" && (
                    <div className="resolution-form override-form">
                      <label>Column to correct
                        <select value={draft.field ?? ""} onChange={(event) => updateDraft(issue.issue_id, { field: event.target.value })}>
                          <option value="">Choose a column…</option>
                          {availableFields.map((field) => <option key={field}>{field}</option>)}
                        </select>
                      </label>
                      <label>Correct value<input value={draft.value ?? ""} onChange={(event) => updateDraft(issue.issue_id, { value: event.target.value })} placeholder="Enter the confirmed value" /></label>
                      <label>Reason for the correction<input value={draft.reason ?? ""} onChange={(event) => updateDraft(issue.issue_id, { reason: event.target.value })} placeholder="Who confirmed this value?" /></label>
                    </div>
                  )}

                  {kind === "duplicate" && (
                    <div className="resolution-form">
                      <label>Authoritative source row<select value={draft.selectedRow ?? ""} onChange={(event) => updateDraft(issue.issue_id, { selectedRow: event.target.value })}><option value="">Choose a row…</option>{issue.source_rows.map((row) => <option key={row} value={row}>Row {row}</option>)}</select></label>
                      <label>Reason for the decision<input value={draft.reason ?? ""} onChange={(event) => updateDraft(issue.issue_id, { reason: event.target.value })} placeholder="How was this row confirmed?" /></label>
                    </div>
                  )}

                  {kind === "remove" && (
                    <label className="remove-resolution"><input type="checkbox" checked={removedIssues.has(issue.issue_id)} onChange={(event) => setRemovedIssues((current) => { const next = new Set(current); if (event.target.checked) next.add(issue.issue_id); else next.delete(issue.issue_id); return next; })} /> Remove this invalid or outdated decision from the downloaded resolutions file</label>
                  )}

                  {kind === "source" && <p className="source-note">This issue cannot be safely represented in <code>resolutions.json</code>. Correct the named input file, then rerun the pipeline.</p>}
                  <details className="evidence-details"><summary>Show pipeline evidence</summary><pre>{JSON.stringify(issue.evidence, null, 2)}</pre></details>
                </div>
              </article>
            );
          })}
        </section>

        <aside className="resolution-panel">
          <p className="card-label">Resolution file</p>
          <h2>Create resolutions.json</h2>
          <p className="resolution-status">{resolutionStatus}</p>
          {resolutionError && <p className="resolution-error">{resolutionError}</p>}
          <label className="file-picker">Choose existing resolutions.json<input type="file" accept="application/json,.json" onChange={(event) => loadResolutionFile(event.target.files?.[0])} /></label>
          <div className="resolution-tally"><strong>{completedIssues.length}</strong><span>corrections ready<br />of {review.blocking_issue_count} blockers</span></div>
          <button className="download-button" disabled={!completedIssues.length || Boolean(resolutionError)} onClick={buildDownload}>Download resolutions.json</button>
          <ol className="next-steps"><li>Download the completed file.</li><li>Replace <code>config/resolutions.json</code>.</li><li>Run <code>python3 pipeline/process_data.py</code>.</li><li>Refresh this page.</li></ol>
          <p className="panel-footnote">Existing valid decisions are preserved in the downloaded file. Source-only issues must still be corrected in the input file.</p>
        </aside>
      </div>
    </main>
  );
}

export default function App() {
  const [review, setReview] = useState<ReviewData | null>(null);
  const [data, setData] = useState<ForecastData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [scoreOverrides, setScoreOverrides] = useState<Record<string, Top8Scores>>({});
  const [bucketOverrides, setBucketOverrides] = useState<Record<string, Bucket>>({});
  const [productFilter, setProductFilter] = useState("All products");
  const [repFilter, setRepFilter] = useState("All reps");
  const [movementTab, setMovementTab] = useState("new_deals");
  const [auditFilter, setAuditFilter] = useState("all");

  useEffect(() => {
    fetch("/review.json")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((reviewData: ReviewData) => {
        setReview(reviewData);
        if (reviewData.blocking_issue_count > 0) return null;
        return fetch("/forecast.json")
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then(setData);
      })
      .catch((error: Error) => setLoadError(error.message));
  }, []);

  const scenarioDeals = useMemo<ScenarioDeal[]>(() => {
    if (!data) return [];
    return data.deals.map((baseDeal) => {
      const annualAcv = baseDeal.annual_acv;
      const stageProbability = baseDeal.stage_probability;
      const scenarioBucket = bucketOverrides[baseDeal.opportunity_id] ?? baseDeal.forecast_bucket;
      const defaultScores = baseDeal.top_8_scores ?? {
        leadership: 3,
        commercial: 3,
        contractual: 3,
        composite_gpa: 3,
      };
      const selectedScores = scoreOverrides[baseDeal.opportunity_id] ?? defaultScores;
      const calculation = probabilityForScores(
        selectedScores.leadership,
        selectedScores.commercial,
        selectedScores.contractual,
      );
      const scenarioScores = scenarioBucket === "top_8"
        ? { ...selectedScores, composite_gpa: calculation.gpa }
        : null;
      const scenarioProbability = scenarioBucket === "top_8" ? calculation.probability : stageProbability;
      return {
        ...baseDeal,
        annual_acv: annualAcv,
        scenario_bucket: scenarioBucket,
        scenario_scores: scenarioScores,
        scenario_probability: scenarioProbability,
        scenario_expected_value: annualAcv * scenarioProbability,
      };
    });
  }, [data, bucketOverrides, scoreOverrides]);

  const scenarioSummary = useMemo(() => {
    const top8 = scenarioDeals
      .filter((deal) => deal.scenario_bucket === "top_8")
      .reduce((total, deal) => total + deal.scenario_expected_value, 0);
    const salesforce = scenarioDeals
      .filter((deal) => deal.scenario_bucket === "salesforce_longtail")
      .reduce((total, deal) => total + deal.scenario_expected_value, 0);
    const carebridge = scenarioDeals
      .filter((deal) => deal.scenario_bucket === "carebridge_longtail")
      .reduce((total, deal) => total + deal.scenario_expected_value, 0);
    return { top8, salesforce, carebridge, total: top8 + salesforce + carebridge };
  }, [scenarioDeals]);

  const hasScenario =
    Object.keys(scoreOverrides).length > 0 ||
    Object.keys(bucketOverrides).length > 0;

  const filteredDeals = useMemo(
    () =>
      scenarioDeals.filter(
        (deal) =>
          (productFilter === "All products" || deal.product === productFilter) &&
          (repFilter === "All reps" || deal.sales_rep === repFilter),
      ),
    [scenarioDeals, productFilter, repFilter],
  );

  const resetScenario = () => {
    setScoreOverrides({});
    setBucketOverrides({});
  };

  const changeScore = (deal: ScenarioDeal, field: "leadership" | "commercial" | "contractual", value: number) => {
    const scores = deal.scenario_scores ?? {
      leadership: 3,
      commercial: 3,
      contractual: 3,
      composite_gpa: 3,
    };
    const next = { ...scores, [field]: value };
    const calculation = probabilityForScores(next.leadership, next.commercial, next.contractual);
    setScoreOverrides((current) => ({
      ...current,
      [deal.opportunity_id]: { ...next, composite_gpa: calculation.gpa },
    }));
  };

  const toggleBucket = (deal: ScenarioDeal) => {
    const longtailBucket: Bucket = deal.source === "carebridge" ? "carebridge_longtail" : "salesforce_longtail";
    setBucketOverrides((current) => ({
      ...current,
      [deal.opportunity_id]: deal.scenario_bucket === "top_8" ? longtailBucket : "top_8",
    }));
    // A deal that began in Top 8 already has an authoritative scorecard. When a
    // user returns it from longtail, keep those original scores instead of
    // replacing them with the generic scores used for a newly promoted deal.
    if (
      deal.scenario_bucket !== "top_8" &&
      deal.forecast_bucket !== "top_8" &&
      !scoreOverrides[deal.opportunity_id]
    ) {
      setScoreOverrides((current) => ({
        ...current,
        [deal.opportunity_id]: { leadership: 3, commercial: 3, contractual: 3, composite_gpa: 3 },
      }));
    }
  };

  if (loadError) return <ErrorState message={loadError} />;
  if (review?.blocking_issue_count) return <ReviewPage review={review} />;
  if (!data) return <LoadingState />;

  const products = ["All products", ...Array.from(new Set(data.deals.map((deal) => deal.product))).sort()];
  const reps = ["All reps", ...Array.from(new Set(data.deals.map((deal) => deal.sales_rep))).sort()];
  const variance = scenarioSummary.total - data.board_target;
  const targetProgress = Math.min((scenarioSummary.total / data.board_target) * 100, 100);
  const chartData = [
    { key: "top_8" as Bucket, name: "Top 8", value: scenarioSummary.top8 },
    { key: "salesforce_longtail" as Bucket, name: "SF longtail", value: scenarioSummary.salesforce },
    { key: "carebridge_longtail" as Bucket, name: "CareBridge", value: scenarioSummary.carebridge },
  ];
  const movementItems = data.week_over_week[movementTab] ?? [];
  const visibleAudits = auditFilter === "all"
    ? data.audit_log
    : data.audit_log.filter((entry) => entry.status === auditFilter);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div>
            <strong>PulseFlow Health</strong>
            <span>Executive forecast</span>
          </div>
        </div>
        <nav className="main-nav" aria-label="Dashboard sections">
          {([
            ["overview", "Overview"],
            ["deals", "Deal Room"],
            ["movement", "Week over week"],
            ["audit", "Data hygiene"],
          ] as [Tab, string][]).map(([key, label]) => (
            <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
              {label}
              {key === "audit" && <span className="nav-count">{data.audit_log.length}</span>}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <span className={`mode-pill ${hasScenario ? "scenario" : ""}`}>
            <span /> {hasScenario ? "What-if scenario" : "Validated baseline"}
          </span>
          <button className="reset-button" disabled={!hasScenario} onClick={resetScenario}>Reset scenario</button>
        </div>
      </header>

      <main className="dashboard">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Q4 2026 · As of {formatDate(data.reporting_date)}</p>
            <h1>
              {tab === "overview" && "Forecast command center"}
              {tab === "deals" && "What-if Deal Room"}
              {tab === "movement" && "Pipeline movement"}
              {tab === "audit" && "Data hygiene & audit"}
            </h1>
            <p className="page-description">
              {tab === "overview" && "A defensible baseline for the Monday executive forecast call."}
              {tab === "deals" && "Model scores and deal placement without changing the validated source baseline."}
              {tab === "movement" && "What changed in Salesforce since last Monday, standardized before comparison."}
              {tab === "audit" && "Every material normalization, correction, warning, and unresolved source conflict."}
            </p>
          </div>
          <div className="snapshot-meta">
            <span>Generated snapshot</span>
            <strong>{new Date(data.generated_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</strong>
          </div>
        </div>

        {tab === "overview" && (
          <>
            <section className="hero-grid">
              <article className="target-card">
                <div className="target-card-top">
                  <div>
                    <p className="card-label">Expected Q4 sales</p>
                    <strong className="hero-number">{money.format(scenarioSummary.total)}</strong>
                  </div>
                  <div className={`variance-badge ${variance >= 0 ? "positive" : "negative"}`}>
                    {variance >= 0 ? "↑" : "↓"} {compactMoney.format(Math.abs(variance))}
                    <span>{variance >= 0 ? "above" : "below"} target</span>
                  </div>
                </div>
                <div className="target-track" aria-label={`${targetProgress.toFixed(1)} percent of target`}>
                  <span style={{ width: `${targetProgress}%` }} />
                  <i style={{ left: "100%" }} />
                </div>
                <div className="target-scale">
                  <span>$0</span>
                  <span>{Math.round((scenarioSummary.total / data.board_target) * 100)}% of {compactMoney.format(data.board_target)} board target</span>
                </div>
              </article>
              <article className="confidence-card">
                <div className="confidence-icon">◇</div>
                <div>
                  <p className="card-label">Baseline confidence</p>
                  <strong>Fully reconciled</strong>
                  <p>Every conflicting duplicate has one confirmed source row.</p>
                </div>
                <button onClick={() => setTab("audit")}>Review evidence →</button>
              </article>
            </section>

            <section className="kpi-grid" aria-label="Forecast components">
              <article className="kpi-card top8">
                <span className="kpi-accent" />
                <div className="kpi-heading"><span>Top 8 strategic</span><i>8 deals</i></div>
                <strong>{money.format(scenarioSummary.top8)}</strong>
                <p>{percent.format(scenarioSummary.top8 / scenarioSummary.total)} of forecast</p>
              </article>
              <article className="kpi-card salesforce">
                <span className="kpi-accent" />
                <div className="kpi-heading"><span>Salesforce longtail</span><i>{scenarioDeals.filter((d) => d.scenario_bucket === "salesforce_longtail").length} deals</i></div>
                <strong>{money.format(scenarioSummary.salesforce)}</strong>
                <p>Stage-weighted core pipeline</p>
              </article>
              <article className="kpi-card carebridge">
                <span className="kpi-accent" />
                <div className="kpi-heading"><span>CareBridge longtail</span><i>{scenarioDeals.filter((d) => d.scenario_bucket === "carebridge_longtail").length} deals</i></div>
                <strong>{money.format(scenarioSummary.carebridge)}</strong>
                <p>Monthly values annualized</p>
              </article>
              <article className="kpi-card target">
                <span className="kpi-accent" />
                <div className="kpi-heading"><span>Variance to target</span><i>{variance >= 0 ? "Ahead" : "Gap"}</i></div>
                <strong className={variance >= 0 ? "positive-text" : "negative-text"}>{money.format(variance)}</strong>
                <p>Against {money.format(data.board_target)}</p>
              </article>
            </section>

            <section className="overview-lower">
              <article className="panel mix-panel">
                <div className="panel-heading">
                  <div><p className="card-label">Forecast composition</p><h2>Expected value by bucket</h2></div>
                  <span className="live-note"><i /> Recalculates live</span>
                </div>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 16, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid stroke="#e7ebed" vertical={false} />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#66727a", fontSize: 12 }} />
                      <YAxis axisLine={false} tickLine={false} tickFormatter={(value) => compactMoney.format(value)} tick={{ fill: "#7b858b", fontSize: 11 }} width={58} />
                      <Tooltip formatter={(value) => money.format(Number(value))} cursor={{ fill: "rgba(23,59,94,.04)" }} contentStyle={{ borderRadius: 12, border: "1px solid #dfe5e7", boxShadow: "0 10px 30px rgba(27,47,60,.12)" }} />
                      <Bar dataKey="value" radius={[8, 8, 2, 2]} maxBarSize={74}>
                        {chartData.map((entry) => <Cell key={entry.key} fill={bucketColors[entry.key]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="legend-row">
                  {chartData.map((item) => <span key={item.key}><i style={{ background: bucketColors[item.key] }} />{item.name}</span>)}
                </div>
              </article>

              <article className="panel momentum-panel">
                <div className="panel-heading">
                  <div><p className="card-label">Since last Monday</p><h2>Pipeline pulse</h2></div>
                  <button className="text-button" onClick={() => setTab("movement")}>View all →</button>
                </div>
                <div className="movement-list">
                  {Object.entries(movementLabels).map(([key, label]) => {
                    const count = data.week_over_week[key]?.length ?? 0;
                    const tone = key === "closed_lost_deals" || key === "slipped_deals" ? "down" : key === "new_deals" ? "up" : "neutral";
                    return (
                      <button key={key} onClick={() => { setMovementTab(key); setTab("movement"); }}>
                        <span className={`movement-icon ${tone}`}>{tone === "up" ? "+" : tone === "down" ? "−" : "↗"}</span>
                        <span><strong>{label}</strong><small>{count === 1 ? "1 opportunity" : `${count} opportunities`}</small></span>
                        <b>{count}</b>
                      </button>
                    );
                  })}
                </div>
              </article>
            </section>

            <section className="panel strategic-table-panel">
              <div className="panel-heading">
                <div><p className="card-label">Executive focus</p><h2>Top 8 strategic deals</h2></div>
                <button className="text-button" onClick={() => setTab("deals")}>Open Deal Room →</button>
              </div>
              <div className="table-scroll">
                <table className="data-table compact-table">
                  <thead><tr><th>Health system</th><th>Product</th><th>Owner</th><th>GPA</th><th>Probability</th><th>Expected value</th></tr></thead>
                  <tbody>
                    {scenarioDeals.filter((deal) => deal.scenario_bucket === "top_8").map((deal) => (
                      <tr key={deal.opportunity_id}>
                        <td><strong>{deal.health_system}</strong><small>{deal.stage}</small></td>
                        <td><span className={`product-pill ${deal.product.toLowerCase()}`}>{deal.product}</span></td>
                        <td>{deal.sales_rep}</td>
                        <td>{deal.scenario_scores?.composite_gpa.toFixed(2)}</td>
                        <td>{percent.format(deal.scenario_probability)}</td>
                        <td className="money-cell">{money.format(deal.scenario_expected_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {tab === "deals" && (
          <section className="panel deal-room-panel">
            <div className="deal-toolbar">
              <div className="filter-group">
                <label>Product<select value={productFilter} onChange={(event) => setProductFilter(event.target.value)}>{products.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label>Sales rep<select value={repFilter} onChange={(event) => setRepFilter(event.target.value)}>{reps.map((item) => <option key={item}>{item}</option>)}</select></label>
              </div>
              <div className="scenario-delta">
                <span>What-if change</span>
                <strong className={scenarioSummary.total - data.summary.total_expected_sales >= 0 ? "positive-text" : "negative-text"}>
                  {money.format(scenarioSummary.total - data.summary.total_expected_sales)}
                </strong>
                <small>vs. validated baseline</small>
              </div>
            </div>
            <div className="deal-room-note">
              <span>i</span>
              The validated baseline is the forecast produced by the pipeline. Top 8 deals use scorecard probability; longtail deals use source-stage probability. These what-if changes stay in this browser session.
            </div>
            <div className="table-scroll deal-table-wrap">
              <table className="data-table deal-table">
                <thead>
                  <tr><th>Deal</th><th>Bucket</th><th>Annual ACV</th><th>Readiness / source state</th><th>Probability</th><th>Expected value</th><th /></tr>
                </thead>
                <tbody>
                  {filteredDeals.map((deal) => (
                    <tr key={deal.opportunity_id}>
                      <td>
                        <strong>{deal.health_system}</strong>
                        <small>{deal.product} · {deal.sales_rep}</small>
                      </td>
                      <td><span className={`bucket-pill ${deal.scenario_bucket}`}>{bucketLabels[deal.scenario_bucket]}</span></td>
                      <td className="money-cell">{money.format(deal.annual_acv)}</td>
                      <td>
                        {deal.scenario_bucket === "top_8" ? (
                          <div className="score-controls">
                            {(["leadership", "commercial", "contractual"] as const).map((field) => (
                              <label key={field} title={titleCase(field)}>
                                <span>{field[0].toUpperCase()}</span>
                                <select value={deal.scenario_scores?.[field] ?? 3} onChange={(event) => changeScore(deal, field, Number(event.target.value))}>
                                  {[1, 2, 3, 4].map((value) => <option key={value}>{value}</option>)}
                                </select>
                              </label>
                            ))}
                            <b>GPA {deal.scenario_scores?.composite_gpa.toFixed(2)}</b>
                          </div>
                        ) : <span className="stage-copy">{deal.stage}<small>{percent.format(deal.stage_probability)} source probability</small></span>}
                      </td>
                      <td><strong>{percent.format(deal.scenario_probability)}</strong></td>
                      <td className="money-cell emphasized">{money.format(deal.scenario_expected_value)}</td>
                      <td>
                        <button className="bucket-action" onClick={() => toggleBucket(deal)}>
                          {deal.scenario_bucket === "top_8" ? "Use stage probability" : "Use Top 8 scorecard"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-footer"><span>Showing {filteredDeals.length} of {scenarioDeals.length} active Q4 deals</span><span>Scenario total <strong>{money.format(scenarioSummary.total)}</strong></span></div>
          </section>
        )}

        {tab === "movement" && (
          <>
            <section className="movement-summary-grid">
              {Object.entries(movementLabels).map(([key, label]) => (
                <button key={key} className={movementTab === key ? "active" : ""} onClick={() => setMovementTab(key)}>
                  <span>{label}</span>
                  <strong>{data.week_over_week[key]?.length ?? 0}</strong>
                  <small>{key === "new_deals" ? "Added this week" : key === "stage_moves" ? "Advanced or regressed" : "Changed since prior file"}</small>
                </button>
              ))}
            </section>
            <section className="panel movement-panel-full">
              <div className="panel-heading">
                <div><p className="card-label">{movementLabels[movementTab]}</p><h2>{movementItems.length} {movementItems.length === 1 ? "opportunity" : "opportunities"}</h2></div>
                <span className="comparison-pill">Current vs. prior Salesforce</span>
              </div>
              {movementItems.length ? (
                <div className="movement-cards">
                  {movementItems.map((item) => (
                    <article key={item.opportunity_id}>
                      <div className="movement-card-top"><span className={`product-pill ${String(item.product).toLowerCase()}`}>{item.product}</span><strong>{movementValue(item, movementTab)}</strong></div>
                      <h3>{item.health_system}</h3>
                      <p>{movementDetail(item, movementTab)}</p>
                      <footer><span>{item.sales_rep}</span><code>{item.opportunity_id}</code></footer>
                    </article>
                  ))}
                </div>
              ) : <div className="empty-state"><span>✓</span><h3>No deals in this category</h3><p>The standardized current and prior files produced no matching changes.</p></div>}
            </section>
          </>
        )}

        {tab === "audit" && (
          <>
            <section className="audit-summary">
              {[
                ["automatically_resolved", "Automatic", "Deterministic pipeline rules"],
                ["human_resolved", "Human confirmed", "Validated resolutions"],
                ["warning", "Warnings", "Retained with evidence"],
              ].map(([status, label, description]) => (
                <button key={status} className={auditFilter === status ? `active ${status}` : status} onClick={() => setAuditFilter(auditFilter === status ? "all" : status)}>
                  <span>{label}</span>
                  <strong>{data.audit_log.filter((entry) => entry.status === status).length}</strong>
                  <small>{description}</small>
                </button>
              ))}
            </section>
            <section className="panel audit-panel">
              <div className="panel-heading">
                <div><p className="card-label">Published run evidence</p><h2>{visibleAudits.length} audit entries</h2></div>
                <button className="filter-reset" onClick={() => setAuditFilter("all")}>Show all</button>
              </div>
              <div className="table-scroll">
                <table className="data-table audit-table">
                  <thead><tr><th>Status</th><th>Issue</th><th>Record & source</th><th>Pipeline action</th><th>Forecast effect</th></tr></thead>
                  <tbody>
                    {visibleAudits.map((entry) => (
                      <tr key={entry.audit_id}>
                        <td><span className={`status-pill ${entry.status}`}>{titleCase(entry.status)}</span></td>
                        <td><strong>{titleCase(entry.type)}</strong><small>Rows {entry.source_rows.join(", ") || "—"}</small></td>
                        <td><code>{entry.record_id ?? "—"}</code><small>{entry.source}</small></td>
                        <td><p>{entry.action}</p><small>Via {entry.resolution_source}</small></td>
                        <td className="money-cell">{impactValue(entry.forecast_impact)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
      <footer className="app-footer">
        <span>PulseFlow Forecast · Generated from immutable source exports</span>
        <span>Rule-based baseline · Session-only scenarios · Full audit trail</span>
      </footer>
    </div>
  );
}
