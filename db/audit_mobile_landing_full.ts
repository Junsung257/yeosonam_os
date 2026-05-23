/**
 * raw_text 기준 등록 상품 — 모바일 랜딩 정형화 전수조사
 *
 * 실행:
 *   npx tsx --env-file=.env.local db/audit_mobile_landing_full.ts
 *   npx tsx --env-file=.env.local db/audit_mobile_landing_full.ts --json=docs/audits/2026-05-22-mobile-landing-audit.json
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { postProcessPackageRow, computeWriteTimePackageState } from '../src/lib/package-post-process';
import { renderPackage, isFerryPackage, type RenderPackageInput } from '../src/lib/render-contract';
import { validatePackageBusinessRules } from '../src/lib/validators/package-rules';
import { runCrossValidation } from '../src/lib/parser';
import type { PriceTier, NoticeItem } from '../src/lib/parser';
import { LEAK_PATTERNS } from '../src/lib/customer-leak-sanitizer';
import { isSynthesizedRawText } from '../src/lib/packages/raw-text';
import { detectCatalogProductFlags } from '../src/lib/parser/deterministic/product-policy';
import { evaluateL1CustomerReadyGate } from '../src/lib/l1-customer-ready-gate';
import { isCustomerVisibleStatus } from '../src/lib/visibility-status';

const PAGE = 100;
const MIN_RAW_LEN = 10;

const SELECT_COLS = [
  'id',
  'internal_code',
  'short_code',
  'status',
  'title',
  'destination',
  'product_type',
  'duration',
  'min_participants',
  'airline',
  'departure_airport',
  'raw_text',
  'inclusions',
  'excludes',
  'notices_parsed',
  'itinerary_data',
  'surcharges',
  'departure_days',
  'optional_tours',
  'price_tiers',
  'customer_notes',
  'internal_notes',
  'special_notes',
  'parser_version',
].join(', ');

type Severity = 'critical' | 'high' | 'medium' | 'low';

interface Finding {
  id: string;
  severity: Severity;
  message: string;
}

interface PackageAudit {
  id: string;
  internal_code: string | null;
  title: string;
  rawTier: 'real' | 'synthesized' | 'short';
  rawLen: number;
  findings: Finding[];
}

function parseArgs(argv: string[]) {
  const jsonArg = argv.find(a => a.startsWith('--json='))?.slice('--json='.length);
  const realOnly = argv.includes('--real-only');
  return { jsonOut: jsonArg ?? null, realOnly };
}

function stableJson(v: unknown): string {
  return JSON.stringify(v ?? null);
}

/** backfill synthesizeRawText 스텁 감지 — SSOT: packages/raw-text */
function isSynthesizedStub(raw: string): boolean {
  return isSynthesizedRawText(raw);
}

function classifyRaw(raw: string | null | undefined): PackageAudit['rawTier'] {
  const len = (raw ?? '').trim().length;
  if (len < MIN_RAW_LEN) return 'short';
  if (isSynthesizedStub(raw!.trim())) return 'synthesized';
  return 'real';
}

function scanLeaks(text: string, fieldPath: string): Finding[] {
  const out: Finding[] = [];
  if (!text) return out;
  for (const rule of LEAK_PATTERNS) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    const matches = text.match(re);
    if (matches?.length) {
      out.push({
        id: `LEAK_${rule.id}`,
        severity: rule.severity,
        message: `${fieldPath}: ${rule.description} — "${matches[0].slice(0, 40)}"`,
      });
    }
  }
  return out;
}

function collectTextBlob(row: Record<string, unknown>, processed: Record<string, unknown>): string {
  const parts: string[] = [];
  const pushArr = (arr: unknown, prefix: string) => {
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (typeof v === 'string') parts.push(`${prefix}[${i}]:${v}`);
      else if (v && typeof v === 'object' && 'text' in v) {
        parts.push(`${prefix}[${i}].text:${String((v as { text?: string }).text ?? '')}`);
      }
    }
  };
  pushArr(processed.excludes as unknown[], 'excludes');
  pushArr(processed.inclusions as unknown[], 'inclusions');
  pushArr(processed.notices_parsed as unknown[], 'notices_parsed');
  if (typeof row.special_notes === 'string') parts.push(`special_notes:${row.special_notes}`);
  if (typeof row.customer_notes === 'string') parts.push(`customer_notes:${row.customer_notes}`);
  const itin = processed.itinerary_data as { days?: Array<{ schedule?: Array<{ activity?: string; time?: string }> }> };
  for (const d of itin?.days ?? []) {
    for (const s of d.schedule ?? []) {
      parts.push(`schedule:${s.time ?? ''} ${s.activity ?? ''}`);
    }
  }
  const sur = row.surcharges;
  if (Array.isArray(sur)) {
    for (const s of sur) {
      if (s && typeof s === 'object') parts.push(`surcharges:${JSON.stringify(s)}`);
    }
  }
  return parts.join('\n');
}

function auditPackage(row: Record<string, unknown>): PackageAudit {
  const raw = String(row.raw_text ?? '');
  const rawTier = classifyRaw(raw);
  const findings: Finding[] = [];
  const code = (row.internal_code as string | null) ?? null;
  const title = String(row.title ?? '').slice(0, 80);

  const processed = postProcessPackageRow(row as Parameters<typeof postProcessPackageRow>[0]);
  const writeState = computeWriteTimePackageState(row as Parameters<typeof computeWriteTimePackageState>[0]);
  const view = renderPackage(writeState as RenderPackageInput);
  const pkgInput = writeState as RenderPackageInput;

  // DB drift — 저장값 vs write-time SSOT (postProcess + sanitize)
  for (const key of ['excludes', 'notices_parsed', 'itinerary_data', 'inclusions', 'product_type', 'parser_version'] as const) {
    if (stableJson(row[key]) !== stableJson(writeState[key])) {
      findings.push({
        id: 'DRIFT_DB',
        severity: 'medium',
        message: `DB 저장값 ≠ write-time SSOT (${key}) — backfill 재실행 필요`,
      });
      break;
    }
  }

  // L1 — 고객 노출 중인데 BLOCK 사유 잔존
  const l1 = evaluateL1CustomerReadyGate({
    row: writeState as Parameters<typeof evaluateL1CustomerReadyGate>[0]['row'],
    rawText: raw,
    internalCode: code,
    shortCode: (row.short_code as string | null) ?? null,
    alreadyProcessed: true,
  });
  if (isCustomerVisibleStatus(row.status as string) && l1.reasons.length > 0) {
    findings.push({
      id: 'L1_APPROVED_BLOCK',
      severity: 'critical',
      message: `status=${row.status} 이지만 L1 BLOCK: ${l1.codes.slice(0, 4).join(', ')}`,
    });
  }

  // W13~W19
  const { warnings } = validatePackageBusinessRules({
    raw_text: raw,
    min_participants: row.min_participants as number | null,
    notices_parsed: processed.notices_parsed as Array<{ text?: string }>,
    surcharges: row.surcharges as unknown[],
    departure_days: row.departure_days as string | string[] | null,
    optional_tours: row.optional_tours as Array<{ name?: string; region?: string }>,
    itinerary_data: processed.itinerary_data as { days?: Array<{ day?: number; schedule?: Array<{ activity?: string | null }> }> },
    duration: row.duration as number | null,
  });
  for (const w of warnings) {
    const sev: Severity = w.includes('[W19]') || w.includes('W13') ? 'high' : 'medium';
    findings.push({ id: w.split(']')[0]?.replace('[', '') ?? 'W_RULE', severity: sev, message: w });
  }

  // Cross-validation C1~C5
  const xvRawText = `duration=${row.duration}, price_tiers=${Array.isArray(row.price_tiers) ? row.price_tiers.length : 0}`;
  const xvChecks = runCrossValidation(
    {
      rawText: xvRawText,
      duration: row.duration as number | undefined,
      price_tiers: row.price_tiers as PriceTier[] | undefined,
      min_participants: row.min_participants as number | undefined,
      notices_parsed: processed.notices_parsed as (string | NoticeItem)[],
    },
    { itineraryData: processed.itinerary_data as Parameters<typeof runCrossValidation>[1] extends infer U ? U extends { itineraryData?: infer I } ? I : never : never },
  );
  for (const c of xvChecks) {
    if (c.passed) continue;
    findings.push({
      id: c.id,
      severity: c.severity === 'critical' ? 'critical' : c.severity === 'high' ? 'high' : 'medium',
      message: c.message,
    });
  }

  // Leak scan
  const blob = collectTextBlob(row, processed as Record<string, unknown>);
  findings.push(...scanLeaks(blob, 'customer_fields'));

  const ferry = isFerryPackage(pkgInput);
  const flags = detectCatalogProductFlags(
    row.title as string,
    raw,
    processed.product_type as string,
  );

  // M1 — 항공 헤더 시간 누락 (패키지·항공 상품)
  if (!ferry) {
    const hasFlightInItin = (processed.itinerary_data as { days?: Array<{ schedule?: Array<{ type?: string }> }> })?.days?.some(d =>
      (d.schedule ?? []).some(s => s.type === 'flight'),
    );
    const meta = (processed.itinerary_data as { meta?: { flight_out?: string; flight_in?: string } })?.meta;
    const hasMetaFlight = Boolean(meta?.flight_out || meta?.flight_in);
    const segs = (processed.itinerary_data as { flight_segments?: unknown[] })?.flight_segments ?? [];

    if (hasFlightInItin || hasMetaFlight || segs.length > 0) {
      const out = view.flightHeader.outbound;
      const inn = view.flightHeader.inbound;
      const missingOut = !out?.depTime && !out?.arrTime;
      const missingIn = !inn?.depTime && !inn?.arrTime;
      if (missingOut || missingIn) {
        findings.push({
          id: 'M1_FLIGHT_HEADER_EMPTY',
          severity: 'high',
          message: `항공 헤더 시간 누락 — out=${out?.depTime ?? '—'}/${out?.arrTime ?? '—'} in=${inn?.depTime ?? '—'}/${inn?.arrTime ?? '—'}`,
        });
      }
    }
  }

  // M2/M3 — 쇼핑 패널티가 surcharges/excludes UI에 노출
  const shopPenaltyRe = /패널티|쇼핑\s*샵|150\s*불|150\s*\$|USD\s*150/i;
  for (const s of view.surchargesMerged) {
    if (shopPenaltyRe.test(s.label)) {
      findings.push({
        id: 'M2_SHOPPING_IN_SURCHARGES',
        severity: 'critical',
        message: `쇼핑 패널티가 추가요금 UI에 노출: "${s.label.slice(0, 60)}"`,
      });
    }
  }
  for (const e of view.excludes.basic) {
    if (shopPenaltyRe.test(e)) {
      findings.push({
        id: 'M3_SHOPPING_IN_EXCLUDES',
        severity: 'high',
        message: `쇼핑 패널티가 불포함 UI에 노출: "${e.slice(0, 60)}"`,
      });
    }
  }

  // M4 — DAY1 미팅에 비현실적 time (다낭 BX 유형)
  const day1 = view.days[0];
  if (day1) {
    for (const item of day1.schedule) {
      const act = item.activity ?? '';
      if (/미팅|meeting|공항\s*미팅/i.test(act) && item.time) {
        findings.push({
          id: 'M4_DAY1_MEETING_TIME',
          severity: 'medium',
          message: `DAY1 미팅에 시각 표기 — "${item.time} ${act.slice(0, 40)}" (출발 N시간 전 계산값 잔존 의심)`,
        });
      }
    }
  }

  // M5 — 공항 줄이 type=normal
  const daysRaw = (processed.itinerary_data as { days?: Array<{ day?: number; schedule?: Array<{ type?: string; activity?: string }> }> })?.days ?? [];
  for (const d of daysRaw) {
    for (const s of d.schedule ?? []) {
      const act = s.activity ?? '';
      if (s.type === 'normal' && /공항|airport/i.test(act) && /출발|도착|탑승|이동/.test(act)) {
        findings.push({
          id: 'M5_AIRPORT_TYPE_NORMAL',
          severity: 'medium',
          message: `DAY${d.day} 공항 일정이 type=normal — "${act.slice(0, 50)}"`,
        });
      }
    }
  }

  // M6 — notices 4타입
  const types = new Set(
    (processed.notices_parsed as Array<{ type?: string }> ?? []).map(n => n.type).filter(Boolean),
  );
  for (const t of ['CRITICAL', 'PAYMENT', 'POLICY', 'INFO']) {
    if (!types.has(t)) {
      findings.push({
        id: 'M6_NOTICE_TYPE_MISSING',
        severity: rawTier === 'real' ? 'high' : 'medium',
        message: `notices_parsed ${t} 누락`,
      });
    }
  }

  // M7 — 일정 없음
  if (view.days.length === 0) {
    findings.push({ id: 'M7_NO_ITINERARY', severity: 'critical', message: 'itinerary_data.days 비어 있음 — 모바일 일정표 렌더 불가' });
  }

  // M8 — 포함사항 비어 있음
  const mealsLen = 0; // meals는 CanonicalInclusions에서 별도 필드 아님
  if (view.inclusions.basic.length === 0 && mealsLen === 0) {
    findings.push({ id: 'M8_EMPTY_INCLUSIONS', severity: 'medium', message: '포함사항(inclusions) 렌더 결과 비어 있음' });
  }

  // M9 — 노팁 상품인데 팁이 includes에
  if (flags.noTip) {
    const tipInInc = view.inclusions.basic.some(inc => /팁|tip/i.test(inc.text) && !/불포함|별도|노팁/.test(inc.text));
    if (tipInInc) {
      findings.push({ id: 'M9_NOTIP_TIP_IN_INCLUDED', severity: 'high', message: '노팁 상품인데 포함사항에 팁 관련 문구' });
    }
  }

  // M10 — W16 departure_days JSON string (UI 깨짐)
  if (row.departure_days && typeof row.departure_days === 'string') {
    const dd = row.departure_days.trim();
    if (dd.startsWith('[')) {
      findings.push({ id: 'M10_DEPARTURE_DAYS_JSON', severity: 'high', message: `departure_days JSON 문자열 — UI 비정상 (${dd.slice(0, 40)}…)` });
    }
  }

  // synthesized tier — 신뢰도 경고
  if (rawTier === 'synthesized') {
    findings.push({
      id: 'STUB_RAW_TEXT',
      severity: 'low',
      message: 'raw_text가 필드 합성 스텁 — W13~W18 원문 대조·재업로드 권장',
    });
  }

  return {
    id: String(row.id),
    internal_code: code,
    title,
    rawTier,
    rawLen: raw.length,
    findings,
  };
}

function summarize(audits: PackageAudit[]) {
  const byId = new Map<string, { count: number; packages: string[] }>();
  const bySev: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  let packagesWithIssues = 0;

  for (const a of audits) {
    const meaningful = a.findings.filter(f => f.id !== 'STUB_RAW_TEXT');
    if (meaningful.length > 0) packagesWithIssues += 1;
    for (const f of a.findings) {
      bySev[f.severity] += 1;
      const cur = byId.get(f.id) ?? { count: 0, packages: [] };
      cur.count += 1;
      if (cur.packages.length < 5) cur.packages.push(a.internal_code ?? a.id.slice(0, 8));
      byId.set(f.id, cur);
    }
  }

  const topIssues = [...byId.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)
    .map(([id, v]) => ({ id, count: v.count, samples: v.packages }));

  return {
    total: audits.length,
    rawTier: {
      real: audits.filter(a => a.rawTier === 'real').length,
      synthesized: audits.filter(a => a.rawTier === 'synthesized').length,
      short: audits.filter(a => a.rawTier === 'short').length,
    },
    packagesWithIssues,
    findingCountsBySeverity: bySev,
    topIssues,
  };
}

(async () => {
  const { jsonOut, realOnly } = parseArgs(process.argv.slice(2));
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const audits: PackageAudit[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await sb
      .from('travel_packages')
      .select(SELECT_COLS)
      .not('raw_text', 'is', null)
      .order('internal_code', { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (error) {
      console.error('query error', error.message);
      process.exit(1);
    }
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    if (rows.length === 0) break;

    for (const row of rows) {
      const raw = String(row.raw_text ?? '').trim();
      if (raw.length < MIN_RAW_LEN) continue;
      const audit = auditPackage(row);
      if (realOnly && audit.rawTier !== 'real') continue;
      audits.push(audit);
    }

    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  const summary = summarize(audits);
  const report = {
    generatedAt: new Date().toISOString(),
    scope: realOnly ? 'real_raw_only' : 'raw_text_len>=10',
    summary,
    audits: audits.filter(a => a.findings.some(f => f.id !== 'STUB_RAW_TEXT' || a.rawTier === 'real')),
  };

  console.log('\n=== 모바일 랜딩 전수조사 (raw_text 기준) ===');
  console.log('대상:', summary.total, '건');
  console.log('  └ real:', summary.rawTier.real, '| synthesized stub:', summary.rawTier.synthesized, '| short(skip):', summary.rawTier.short);
  console.log('이슈 있는 상품:', summary.packagesWithIssues, '/', summary.total);
  console.log('심각도별 finding 수:', summary.findingCountsBySeverity);
  console.log('\nTop 이슈:');
  for (const t of summary.topIssues) {
    console.log(`  ${t.id}: ${t.count}건 — e.g. ${t.samples.join(', ')}`);
  }

  const criticalPkgs = audits.filter(a =>
    a.findings.some(f => f.severity === 'critical' && f.id !== 'STUB_RAW_TEXT'),
  );
  if (criticalPkgs.length) {
    console.log('\nCRITICAL 상품 (최대 15):');
    for (const a of criticalPkgs.slice(0, 15)) {
      const crits = a.findings.filter(f => f.severity === 'critical').map(f => f.id);
      console.log(`  ${a.internal_code ?? a.id} | ${crits.join(', ')} | ${a.title.slice(0, 40)}`);
    }
  }

  if (jsonOut) {
    const outPath = path.resolve(jsonOut);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    console.log('\nJSON 저장:', outPath);
  }

  process.exit(0);
})();
