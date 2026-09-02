# KPI Lineage

## Finding

`GET /api/admin/agent/office` reads only the latest 240 tasks, 240 approvals, 160 incidents, and 320 traces. `buildAgentOfficeSnapshot()` then calculates 24-hour/7-day totals and trace P95 from those bounded arrays. The current UI correctly describes this as an operator snapshot, but the values are not complete period KPIs when a source has more rows than its limit.

Office V2 must separate:

- exact server-side aggregates for KPI values;
- bounded rows for drilldown and recent activity;
- explicit freshness and reconciliation evidence.

## Current KPI Lineage And Required Correction

| Metric key / display | Current source and calculation | Version | Window | Freshness | Drilldown | Reconciliation query / decision |
|---|---|---|---|---|---|---|
| `office.active_workrooms` / 활성 작업실 | latest task array grouped by `correlation_id`; active derived from returned workrooms | `snapshot-v1` | apparent current | snapshot `generatedAt`, latest task age | active workroom list | `aggregate-v2`: group all nonterminal tasks by correlation and derive stale/block state before limiting drilldown |
| `office.stale_workrooms` / 멈춘 작업실 | latest tasks; active state older than 24h | `snapshot-v1` | current | same | stale workroom list | exact count of correlations whose latest nonterminal task update is older than 24h; reconcile count to unpaginated grouped query |
| `office.pending_approvals` / 승인 대기 | latest approval array `status='pending'` | `snapshot-v1` | current | latest approval read | approval table | exact `count(*)` from `agent_approvals` where pending; compare to bounded list count and expose `hasMore` |
| `office.overdue_approvals` / 기한 경과 | pending plus explicit expiry or default 7d | `snapshot-v1` | current | same | overdue approval list | exact predicate in server aggregate: `expires_at <= now OR (expires_at IS NULL AND requested_at <= now-7d)` |
| `office.failed_tasks_24h` / 24시간 실패 | latest tasks filtered by failed and `updated_at` | `snapshot-v1` | rolling 24h | latest task update | failed task list | exact `count(*)` using a defined failure timestamp; until a Run exists use `updated_at` and document approximation |
| `office.completion_rate_7d` / 7일 완료율 | `done / (done + failed)` from latest tasks | `snapshot-v1` | rolling 7d | latest task update | terminal tasks | exact aggregate over terminal timestamp; exclude cancelled/expired from denominator by versioned definition; return numerator and denominator |
| `office.terminal_tasks_7d` / 7일 종료 표본 | done+failed from latest tasks | `snapshot-v1` | rolling 7d | same | terminal list | exact done+failed count over terminal timestamp; this is denominator evidence, not a success metric alone |
| `office.multi_agent_workrooms_7d` / 협업 작업실 | distinct task role labels under one correlation from bounded workrooms | `snapshot-v1` | rolling 7d | same | workroom list | retain as `observed_collaboration` until Runs exist; later require distinct run/session and role policy evidence |
| `office.trace_p95_ms` / Trace P95 | P95 over latest 320 trace durations regardless of full period | `snapshot-v1` | latest rows, not explicit period | latest span | trace timeline | `trace-p95-24h-v2`: `percentile_cont(0.95)` over completed spans in a fixed 24h window; return sample count |
| `office.critical_incidents` / Critical Incident | not a primary current snapshot KPI | none | current/24h must be chosen | latest incident | incident list | define `open critical` only if incident lifecycle has open/resolved authority; current table has no status, so display recent critical count with explicit window instead |

## Proposed Exact Aggregate Shape

The aggregate endpoint/RPC returns metrics and lineage together:

```json
{
  "metricKey": "office.completion_rate_7d",
  "metricVersion": "2",
  "value": 94.2,
  "unit": "percent",
  "window": { "kind": "rolling", "from": "...", "to": "..." },
  "source": ["agent_tasks"],
  "numerator": 113,
  "denominator": 120,
  "sampleCount": 120,
  "freshAsOf": "...",
  "reconciledAt": "...",
  "drilldown": { "route": "/admin/agent-mas", "filter": "terminal_7d" }
}
```

No UI calculation may replace this value with `rows.filter(...).length`.

## Future Office V2 KPIs: Availability Gate

| Desired display | Status at baseline | Required authoritative data before display |
|---|---|---|
| 오늘 자동 정상 완료 | `BLOCKED` | Run/Task outcome classification plus deterministic exclusion of human actions and retries |
| AI 보조 완료 | `BLOCKED` | intervention/completion-mode reason code and final human contribution |
| 사람 승인 완료 | `BLOCKED` | exact approved command subject plus successful receipt |
| 사람 직접 처리 | `BLOCKED` | explicit completion actor/mode, not inferred from missing Run |
| 진행 중 | `AVAILABLE WITH CORRECTION` | exact current nonterminal Task/Run aggregate and freshness |
| 대표 승인 | `AVAILABLE WITH CORRECTION` | exact pending nonexpired approvals, risk threshold and owner-required policy |
| Critical Incident | `PARTIAL` | current recent critical events; open incident KPI requires incident resolution lifecycle |
| 팀별 검증/초안/차단 | `BLOCKED` | stable `task_key`, Role Registry department mapping, and task-specific outcome codes |
| 비용 / 성공 작업당 비용 | `BLOCKED` | normalized Run usage and cost reconciliation; OTel-only or partial local counters are insufficient |
| 자동화율 | `BLOCKED` | mutually exclusive completion-mode categories and exact total workload denominator |
| 사람 개입 이유 | `BLOCKED` | closed intervention reason-code registry and consistent write path |

The Office must render `데이터 계약 준비 중` or omit a metric when authority is blocked. It must not fill gaps with task count, model-call count, or visual estimates.

## Metric Definitions For The First Pilot

| Metric key | Definition | Target type |
|---|---|---|
| `technology_scout.contract_pass_rate` | runs passing every deterministic output-contract check / completed runs | hard gate, 100% |
| `technology_scout.supported_claim_rate` | externally changeable claims with a direct primary-source evidence ref / all such claims | hard gate, 100% for decision-bearing claims |
| `technology_scout.license_accuracy` | human-adjudicated license class matches / adjudicated cases | hard gate, 100% |
| `technology_scout.false_adopt_rate` | unsafe/incompatible cases recommended `ADOPT` / unsafe/incompatible cases | hard gate, 0% |
| `technology_scout.task_success` | cases meeting all required outcomes / cases | promotion comparison metric |
| `technology_scout.cost_per_success` | normalized model cost / successful runs | report, task-specific threshold |
| `technology_scout.p95_latency_ms` | Run elapsed P95 over completed trials | report, task-specific threshold |
| `technology_scout.human_correction_rate` | adjudicated runs requiring material correction / adjudicated runs | promotion comparison metric |

There is no global “five successful runs” promotion rule. Each Task Contract sets risk, quality, cost, latency, sample-size, and regression thresholds.

## Reconciliation Rules

1. Each metric version has exactly one source query or RPC implementation.
2. The query returns its own numerator, denominator, sample count, and window.
3. A second, slower reconciliation query is documented for release/readiness checks.
4. The aggregate and reconciliation results must match exactly for counts and within declared rounding for rates/percentiles.
5. A freshness breach marks the metric stale; it does not silently display the last value as current.
6. Drilldown row limits never change the KPI value.
7. Metric definition changes increment `metricVersion`; they do not rewrite historical meaning.
8. Domain financial, booking, publication, and customer KPIs continue to come from their domain SSOT/RPCs, not from generic Agent Office task counts.

## Office V2 P0 Ordering

```text
authoritative KPI source RPC
  -> calculation version
  -> freshness contract
  -> reconciliation query
  -> exact drilldown
  -> Office V2 UI
  -> Visual Office projection last
```

Shadow `agent_runs` is excluded from KPI authority until reconciliation and a separate promotion decision are complete. A bounded Office array may render recent detail but cannot provide a period KPI or rollout gate.
