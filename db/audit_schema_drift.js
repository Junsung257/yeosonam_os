/**
 * @file audit_schema_drift.js
 * @description 전체 travel_packages + attractions 레코드를 스캔해
 *              정규 스키마와의 drift(포맷 불일치)를 전수 감사.
 *
 * 검사 항목:
 *   1. travel_packages.departure_days — JSON 배열 문자열 여부
 *   2. travel_packages.optional_tours — region 누락 + 모호 이름 여부
 *   3. travel_packages.itinerary_data — { days: [...] } vs [...] 포맷 혼재
 *   4. travel_packages.status — draft/validated/published/archived 외 값
 *   5. attractions.photos — 구형식 {url,thumb} vs 신형식 {src_medium,src_large}
 *   6. attractions.aliases — null vs 빈 배열 혼재
 *
 * 사용법:
 *   node db/audit_schema_drift.js              # 요약만
 *   node db/audit_schema_drift.js --detail     # 개별 레코드까지
 *   node db/audit_schema_drift.js --json       # JSON 리포트 (CI 용)
 *   node db/audit_schema_drift.js --fail-on-drift  # drift > 0 이면 exit 1 (CI gate)
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [k, ...rest] = line.split('=');
    if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DETAIL = process.argv.includes('--detail');
const JSON_OUT = process.argv.includes('--json');

const AMBIGUOUS_OT = ['2층버스', '리버보트', '야시장투어', '크루즈', '마사지', '스카이파크', '스카이 파크'];
const INTERNAL_KEYWORDS_LEAK = ['커미션', 'commission_rate', '정산', '스키마 제약', 'LAND_OPERATOR', '[랜드사', 'net_price', 'margin_rate'];
const OT_REGION_KW = ['말레이시아', '쿠알라', '말라카', '겐팅', '싱가포르', '태국', '방콕', '파타야', '푸켓', '베트남', '다낭', '하노이', '나트랑', '대만', '타이페이', '타이베이', '일본', '후쿠오카', '오사카', '중국', '서안', '라오스', '몽골', '필리핀', '보홀', '세부', '인도네시아', '발리'];

async function paginatedFetch(table, select, filter) {
  const out = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    let q = sb.from(table).select(select).range(offset, offset + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

(async () => {
  const report = {
    scanned_at: new Date().toISOString(),
    packages: { total: 0, drift: [] },
    attractions: { total: 0, drift: [] },
    summary: {},
  };

  // ── Packages 감사 ─────────────────────────────────────────────────
  const pkgs = await paginatedFetch('travel_packages', 'id, title, duration, status, departure_days, optional_tours, itinerary_data');
  report.packages.total = pkgs.length;

  let jsonArrayDeparture = 0;
  let optTourRegionMissing = 0;
  let itineraryObjectFormat = 0;
  let statusInvalid = 0;
  let internalKeywordLeaks = 0;

  for (const pkg of pkgs) {
    const issues = [];

    // 1. departure_days JSON 배열 문자열
    if (typeof pkg.departure_days === 'string') {
      const dd = pkg.departure_days.trim();
      if (dd.startsWith('[') && dd.endsWith(']')) {
        issues.push({ field: 'departure_days', issue: 'JSON_ARRAY_STRING', value: dd });
        jsonArrayDeparture++;
      }
    }

    // 2. optional_tours region 누락 (모호 이름만 카운트)
    if (Array.isArray(pkg.optional_tours)) {
      for (const t of pkg.optional_tours) {
        if (!t.name) continue;
        const nameHasRegion = OT_REGION_KW.some(kw => t.name.includes(kw));
        const isAmbiguous = AMBIGUOUS_OT.some(kw => t.name.includes(kw));
        if (isAmbiguous && !nameHasRegion && !t.region) {
          issues.push({ field: 'optional_tours', issue: 'AMBIGUOUS_NO_REGION', name: t.name });
          optTourRegionMissing++;
        }
      }
    }

    // 3. itinerary_data 포맷 (배열 권장, 객체 { days: [...] }는 레거시)
    if (pkg.itinerary_data && !Array.isArray(pkg.itinerary_data) && typeof pkg.itinerary_data === 'object') {
      if ('days' in pkg.itinerary_data) {
        issues.push({ field: 'itinerary_data', issue: 'OBJECT_WRAPPER_FORMAT' });
        itineraryObjectFormat++;
      }
    }

    // 3-B. special_notes에 내부 키워드 누출 (ERR-FUK-customer-leaks)
    if (pkg.special_notes && typeof pkg.special_notes === 'string') {
      const leaked = INTERNAL_KEYWORDS_LEAK.filter(kw => pkg.special_notes.includes(kw));
      if (leaked.length > 0) {
        issues.push({ field: 'special_notes', issue: 'INTERNAL_KEYWORD_LEAK', keywords: leaked });
        internalKeywordLeaks++;
      }
    }

    // 4. status 값 유효성 (레거시 워크플로우 status 값도 허용)
    const validStatuses = new Set([
      'draft', 'validated', 'published',
      'pending', 'pending_review', 'pending_replace',
      'approved', 'active', 'available',
      'archived',
    ]);
    if (pkg.status && !validStatuses.has(pkg.status)) {
      issues.push({ field: 'status', issue: 'INVALID_STATUS', value: pkg.status });
      statusInvalid++;
    }

    if (issues.length > 0) {
      report.packages.drift.push({ id: pkg.id, title: pkg.title, duration: pkg.duration, issues });
    }
  }

  // ── Attractions 감사 ──────────────────────────────────────────────
  const attrs = await paginatedFetch('attractions', 'id, name, country, region, photos, aliases', q => q.not('photos', 'is', null));
  report.attractions.total = attrs.length;

  let legacyPhotos = 0;
  let aliasesNull = 0;

  for (const a of attrs) {
    const issues = [];

    if (Array.isArray(a.photos) && a.photos.length > 0) {
      const first = a.photos[0];
      const hasNew = first && ('src_medium' in first || 'src_large' in first);
      const hasLegacy = first && ('url' in first || 'thumb' in first);
      if (!hasNew && hasLegacy) {
        issues.push({ field: 'photos', issue: 'LEGACY_FORMAT', sample_keys: Object.keys(first).join(',') });
        legacyPhotos++;
      }
    }

    if (a.aliases === null) {
      issues.push({ field: 'aliases', issue: 'NULL_INSTEAD_OF_EMPTY_ARRAY' });
      aliasesNull++;
    }

    if (issues.length > 0) {
      report.attractions.drift.push({ id: a.id, name: a.name, issues });
    }
  }

  report.summary = {
    packages_total: report.packages.total,
    packages_with_drift: report.packages.drift.length,
    packages_issues: {
      departure_days_json_array: jsonArrayDeparture,
      optional_tours_ambiguous_no_region: optTourRegionMissing,
      itinerary_data_object_wrapper: itineraryObjectFormat,
      status_invalid: statusInvalid,
      internal_keyword_leaks: internalKeywordLeaks,
    },
    attractions_total: report.attractions.total,
    attractions_with_drift: report.attractions.drift.length,
    attractions_issues: {
      photos_legacy_format: legacyPhotos,
      aliases_null: aliasesNull,
    },
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // 사람이 읽는 포맷
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Schema Drift Audit Report');
  console.log(`  Scanned: ${report.scanned_at}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📦 travel_packages');
  console.log(`  Total: ${report.summary.packages_total}`);
  console.log(`  Drift: ${report.summary.packages_with_drift}건`);
  for (const [k, v] of Object.entries(report.summary.packages_issues)) {
    if (v > 0) console.log(`    - ${k}: ${v}건`);
  }
  console.log();

  console.log('🗺️  attractions');
  console.log(`  Total: ${report.summary.attractions_total}`);
  console.log(`  Drift: ${report.summary.attractions_with_drift}건`);
  for (const [k, v] of Object.entries(report.summary.attractions_issues)) {
    if (v > 0) console.log(`    - ${k}: ${v}건`);
  }
  console.log();

  if (DETAIL) {
    if (report.packages.drift.length > 0) {
      console.log('━━━ Package Drift Detail ━━━');
      for (const p of report.packages.drift) {
        console.log(`  [${p.duration}일] ${p.title}`);
        for (const issue of p.issues) {
          console.log(`    - ${issue.field}: ${issue.issue}${issue.name ? ` (${issue.name})` : ''}${issue.value ? ` value=${JSON.stringify(issue.value)}` : ''}`);
        }
      }
      console.log();
    }
    if (report.attractions.drift.length > 0) {
      console.log('━━━ Attraction Drift Detail ━━━');
      for (const a of report.attractions.drift.slice(0, 50)) {
        console.log(`  ${a.name}`);
        for (const issue of a.issues) {
          console.log(`    - ${issue.field}: ${issue.issue}${issue.sample_keys ? ` (${issue.sample_keys})` : ''}`);
        }
      }
      if (report.attractions.drift.length > 50) console.log(`  ... ${report.attractions.drift.length - 50}건 더 있음`);
      console.log();
    }
  }

  const totalDrift = report.summary.packages_with_drift + report.summary.attractions_with_drift;
  if (totalDrift === 0) {
    console.log('✅ Drift 없음. 모든 레코드가 정규 스키마 준수.\n');
  } else {
    console.log(`⚠️  총 ${totalDrift}건 drift 발견. --detail 플래그로 상세 확인.\n`);
    if (process.argv.includes('--fail-on-drift')) {
      console.error('❌ --fail-on-drift: drift 있음 → exit 1 (CI gate).');
      process.exit(1);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
