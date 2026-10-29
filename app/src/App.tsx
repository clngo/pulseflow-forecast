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

interface SourceVariant {
  source_row: number;
  stage: string;
  stage_probability: number;
  amount: number;
  annual_acv: number;
  expected_value: number;
}

interface SourceConflict {
  status: "unresolved";
  baseline_source_row: number;
  variants: SourceVariant[];
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
  source_conflict: SourceConflict | null;
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
  status: "automatically_resolved" | "human_resolved" | "warning" | "unresolved";
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
    unresolved_variant_count: number;
  };
  deals: Deal[];
  week_over_week: Record<string, MovementItem[]>;
  audit_log: AuditEntry[];
}

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

export default function App() {
  const [data, setData] = useState<ForecastData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [scoreOverrides, setScoreOverrides] = useState<Record<string, Top8Scores>>({});
  const [bucketOverrides, setBucketOverrides] = useState<Record<string, Bucket>>({});
  const [variantSelections, setVariantSelections] = useState<Record<string, number>>({});
  const [productFilter, setProductFilter] = useState("All products");
  const [repFilter, setRepFilter] = useState("All reps");
  const [movementTab, setMovementTab] = useState("new_deals");
  const [auditFilter, setAuditFilter] = useState("all");

  useEffect(() => {
    fetch("/forecast.json")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(setData)
      .catch((error: Error) => setLoadError(error.message));
  }, []);

  const scenarioDeals = useMemo<ScenarioDeal[]>(() => {
    if (!data) return [];
    return data.deals.map((baseDeal) => {
      const selectedRow = variantSelections[baseDeal.opportunity_id];
      const variant = baseDeal.source_conflict?.variants.find((item) => item.source_row === selectedRow);
      const annualAcv = variant?.annual_acv ?? baseDeal.annual_acv;
      const stageProbability = variant?.stage_probability ?? baseDeal.stage_probability;
      const stage = variant?.stage ?? baseDeal.stage;
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
        source_row: variant?.source_row ?? baseDeal.source_row,
        stage,
        stage_probability: stageProbability,
        annual_acv: annualAcv,
        scenario_bucket: scenarioBucket,
        scenario_scores: scenarioScores,
        scenario_probability: scenarioProbability,
        scenario_expected_value: annualAcv * scenarioProbability,
      };
    });
  }, [data, bucketOverrides, scoreOverrides, variantSelections]);

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
    Object.keys(bucketOverrides).length > 0 ||
    Object.keys(variantSelections).length > 0;

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
    setVariantSelections({});
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
                  <strong>{data.summary.unresolved_variant_count === 0 ? "Fully reconciled" : "One bounded conflict"}</strong>
                  <p>{data.summary.unresolved_variant_count === 0
                    ? "All source decisions are confirmed."
                    : "The conservative baseline is valid; one source variant remains explorable."}</p>
                </div>
                <button onClick={() => setTab(data.summary.unresolved_variant_count ? "deals" : "audit")}>Review evidence →</button>
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
                    <tr key={deal.opportunity_id} className={deal.source_conflict ? "conflict-row" : ""}>
                      <td>
                        <strong>{deal.health_system}</strong>
                        <small>{deal.product} · {deal.sales_rep}</small>
                        {deal.source_conflict && <span className="inline-warning">Source conflict</span>}
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
                        ) : deal.source_conflict ? (
                          <label className="variant-select">
                            <span>Forecast variant</span>
                            <select
                              value={variantSelections[deal.opportunity_id] ?? deal.source_conflict.baseline_source_row}
                              onChange={(event) => setVariantSelections((current) => ({ ...current, [deal.opportunity_id]: Number(event.target.value) }))}
                            >
                              {deal.source_conflict.variants.map((variant) => (
                                <option key={variant.source_row} value={variant.source_row}>
                                  {money.format(variant.annual_acv)} · {variant.stage} · {percent.format(variant.stage_probability)}
                                </option>
                              ))}
                            </select>
                          </label>
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
                ["unresolved", "Unresolved", "Bounded forecast variants"],
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
