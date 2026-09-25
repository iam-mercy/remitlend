# RemitLend – Lenders Dashboard Design

## Project Overview

RemitLend's Lender Command Center is a high-performance dashboard built for liquidity providers managing complex yield strategies. The interface prioritizes real-time data accuracy, seamless asset deployment, and a consistent gamification loop — keeping lenders informed, in control, and engaged.

---

## Key Design Contributions

### Yield Data Visualization

Designed the **Total Yield Generated** interactive chart, giving lenders a clear view of their earnings over time. Users can toggle between timeframes (1D, 1W, 1M) to track percentage growth at a glance. The chart uses smooth curve rendering against the dark background to keep focus on the numbers.

### Asset Deployment Workflow

Developed the **Expand Position** component — a streamlined right-aligned sidebar that simplifies the deposit flow. Key details surfaced inline:

- Estimated APR based on current pool utilization
- Platform fee breakdown before confirmation
- Instant feedback on position size impact

### Active Position Tracking

Created a comprehensive **Position Monitoring** table that gives lenders a full picture of their deployed capital:

- Asset balances per pool
- Accrued yield with color-coded profit indicators (green for gains, amber for pending)
- Real-time transaction statuses — Active vs. Pending

### Risk & Health Metrics

Integrated **Pool Health bars** and risk-level indicators within the Prime Lending Pool cards. Each card surfaces:

- Current utilization rate
- Pool stability score driven by citadel governance data
- Risk tier label (Low / Medium / High) for quick scanning

### Gamified Retention

Integrated the **RemitLend Quests** sidebar to tie financial actions directly to XP rewards, maintaining the gamification loop established across the platform. Featured quests include:

- Whale Migration — reward for deploying above a threshold liquidity amount
- Iron Resolve — reward for maintaining an active position over a set duration

---

## Design Principles

- Data density without clutter — lenders need numbers fast, not buried
- Real-time feedback on every action
- Risk transparency — health and stability always visible, never hidden
- Consistent gamification loop across borrower and lender experiences

---

## Color Palette

| Role | Value |
|---|---|
| Background | `#0D0D12` (Obsidian) |
| Surface | `#16161F` |
| Primary Accent | `#7C3AED` (Neon Purple) |
| Secondary Accent | `#0ECFCF` (Teal) |
| Profit Indicator | `#22C55E` |
| Pending Indicator | `#F59E0B` |
| Danger / Loss | `#EF4444` |
| Text Primary | `#F1F5F9` |
| Text Muted | `#64748B` |

---

## Core UI Modules

### Total Yield Chart
- Line chart with timeframe toggle (1D / 1W / 1M)
- Percentage growth delta displayed above chart
- Smooth curve on dark canvas with teal stroke

### Expand Position Sidebar
- Right-aligned slide-in panel
- Input field for deposit amount
- Live Estimated APR and fee preview
- Confirm CTA with loading state

### Position Monitoring Table
- Columns: Asset, Pool, Balance, Accrued Yield, Status
- Color-coded yield values
- Status badges: Active (teal), Pending (amber)

### Prime Lending Pool Cards
- Pool name and asset pair
- Utilization bar with percentage label
- Risk tier badge
- Pool health score from governance data
- Deposit CTA

### RemitLend Quests Sidebar
- Active quest list with XP reward previews
- Progress bars tied to on-chain lender actions
- Completion animation on quest finish

---

## Pool Health & Risk Explanation Surfaces

This section defines the frontend surfaces that communicate pool health and explain risk to lenders. All values are derived from authoritative sources — the pool API and on-chain governance data — never computed or guessed client-side.

### Data Sources & Authority

- **Pool health score, utilization, and risk tier** come from the pool API response (`GET /pools/:id/health`) and citadel governance data. The frontend renders these values verbatim; it does not recompute scores, utilization, or tiers.
- **Risk explanations** are sourced from the API's `riskFactors[]` array (each with `code`, `severity`, `label`, `detail`). The UI maps known `code` values to display copy and falls back to the API-provided `label`/`detail` for unknown codes, so new backend factors render without a frontend release.
- **Staleness** is determined from the API-provided `asOf` timestamp compared against the client clock; the UI never infers freshness from fetch time alone.

### Pool Health Surface

Displayed on each Prime Lending Pool card and in the pool detail view:

- **Health score** — numeric score with a labeled band (Healthy / Watch / At Risk) derived from API-provided thresholds, not hardcoded cutoffs.
- **Utilization bar** — percentage label rendered directly from the API value.
- **Risk tier badge** — Low / Medium / High, colored per the palette (teal / amber / red).
- **As-of timestamp** — shown next to the score so lenders can judge freshness.

### Risk Explanation Surface

A collapsible **"Why this risk level?"** panel on each pool card and detail view:

- Lists each `riskFactor` with its severity indicator and human-readable explanation.
- Groups factors by severity (High → Medium → Low) for quick scanning.
- Shows an explicit empty state ("No active risk factors reported") when the API returns none.
- Links each factor to its authoritative source label (e.g. governance, utilization, oracle) so lenders can trace the claim.

### State Handling

Every health/risk surface implements these explicit states:

| State | Trigger | UI Behavior |
|---|---|---|
| Loading | Initial fetch in flight | Skeleton placeholders; no stale numbers shown |
| Success | Fresh data (`asOf` within freshness window) | Render score, tier, and factors |
| Stale | `asOf` older than freshness window | Render last-known values with a "Stale" badge and as-of time; disable deposit CTA until refreshed |
| Authorization failure | 401/403 from API | Show "Sign in to view pool health" / "You don't have access to this pool"; do not render partial data |
| Dependency failure | 5xx / network error | Show retry affordance with bounded exponential backoff; preserve last-known values marked stale |
| Empty | Pool has no health data | Neutral "Health data unavailable" state; never fabricate a score |

### Validation & Bounded Behavior

- Health/risk payloads are validated against the expected shape before render; malformed payloads fall back to the dependency-failure state rather than rendering partial or NaN values.
- Retries use bounded exponential backoff with a maximum attempt count; after exhaustion the surface stays in the dependency-failure state with a manual retry control.
- No unbounded polling: refresh is driven by the existing dashboard refresh cadence and user-initiated retry.

### Observability & Diagnostics

- Structured client errors are emitted for validation failures, authorization failures, and exhausted retries, including pool id and error code (no secrets or PII).
- Stale-data renders emit a diagnostic event so operational dashboards can track how often lenders see stale health.

### Compatibility

- No backend contract or schema changes: the surfaces consume existing pool health and governance endpoints as-is.
- Unknown `riskFactor.code` values degrade gracefully to API-provided copy, preserving forward compatibility with new backend factors.
- Persisted lender data and existing API consumers are unaffected.

---

## Lender Yield Export with Data Provenance

This section defines the frontend **lender yield export** surface. It lets a lender export their historical yield as CSV (and PDF where supported) while attaching verifiable provenance so every exported figure can be traced back to its authoritative source. All financial values are read from existing authoritative sources — the yield/positions API and on-chain data — and are never recomputed client-side.

### Data Sources & Authority

- **Yield rows** come from the existing lender yield/positions API (the same source that feeds the Total Yield chart and Position Monitoring table). The export renders these values verbatim; it does not recompute accrued yield, APR, or balances.
- **Provenance** is assembled from source metadata already returned by those endpoints plus chain references where available:
  - `sourceId` — the authoritative endpoint/collection the row was read from (e.g. `positions`, `yield-history`).
  - `retrievedAt` — the client timestamp when the export snapshot was fetched.
  - `asOf` — the API-provided data timestamp for the row (authoritative freshness), distinct from `retrievedAt`.
  - `chainId` / `blockNumber` / `txHash` — chain/block references when the source provides them; omitted (not fabricated) when unavailable.
  - `method` — the calculation method label reported by the source (e.g. `accrued-yield-v1`); the frontend echoes it and never substitutes its own formula.
- **Staleness** is judged from the API-provided `asOf` compared against the client clock, consistent with the health/risk surfaces; the export never infers freshness from fetch time alone.

### Export Surface

- An **Export Yield** action on the Position Monitoring table and the Total Yield chart header.
- Format selector: **CSV** (always available) and **PDF** (only when the PDF renderer is available; otherwise the option is disabled with an explanatory tooltip).
- Scope selector: current timeframe (1D / 1W / 1M) or full history, bounded to the API's supported range.
- A **provenance header** is prepended to every export containing: export id, generated-at timestamp, lender id, requested scope/timeframe, source identifiers, and the calculation method label(s) used.
- Each data row carries its own `asOf`, `sourceId`, and chain reference columns so provenance travels with the data, not just the header.

### State Handling

| State | Trigger | UI Behavior |
|---|---|---|
| Loading | Export snapshot fetch in flight | Disable the action, show progress; no partial file emitted |
| Success | Fresh data (`asOf` within freshness window) | Download file with provenance header and per-row provenance |
| Stale | `asOf` older than freshness window | Warn that data is stale, show as-of time, and require explicit confirmation before export; mark rows stale in the file |
| Authorization failure | 401/403 from API | Show "Sign in to export your yield" / "You don't have access to this data"; emit no file |
| Dependency failure | 5xx / network error | Show retry affordance with bounded exponential backoff; never emit a partial or empty file |
| Empty | No yield rows in scope | Neutral "No yield to export for this period" state; do not emit an empty file |

### Validation & Bounded Behavior

- The export payload is validated against the expected shape before serialization; malformed rows cause the export to fail into the dependency-failure state rather than emitting partial or NaN values.
- Export scope is bounded to the API's supported range and a maximum row count; larger requests are rejected with a clear message rather than truncated silently.
- Retries use bounded exponential backoff with a maximum attempt count; after exhaustion the surface stays in the dependency-failure state with a manual retry control.
- CSV values are escaped per RFC 4180 to prevent formula/CSV injection from any source-provided string fields.

### Observability & Diagnostics

- Structured client events are emitted for export start, success, validation failure, authorization failure, and exhausted retries, including lender id, scope, format, and error code (no secrets or PII).
- Stale-data exports emit a diagnostic event so operational dashboards can track how often lenders export stale yield.
- Each export carries a generated `exportId` in both the provenance header and the diagnostic event for audit correlation.

### Compatibility

- No backend contract or schema changes: the export consumes existing yield/positions endpoints as-is.
- Unknown or missing provenance fields degrade gracefully — the column is omitted or marked `unavailable` rather than fabricated.
- Persisted lender data and existing API consumers are unaffected.

---

## Design Goals for Future Iterations

- Multi-pool rebalancing flow
- Notification alerts for pool health drops
- Mobile-optimized position monitoring view
