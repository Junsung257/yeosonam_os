#!/usr/bin/env node
/**
 * @file db/audit_existing_packages.js
 * @description 기존 등록 상품 일괄 점검 (P3 #3, ERR-graybox-existing-data@2026-04-27)
 *
 * 목적: 정책 변화(customer_notes/internal_notes 분리, commission_fixed_amount, FIELD_POLICY 강화)
 *   이전에 등록된 상품 중 회색지대 데이터를 식별·보고. 위험한 자동 수정은 보고만 수행.
 *
 * 점검 항목:
 *   1. SPLIT-NOTES — special_notes 만 있고 customer_notes/internal_notes 가 비어있음 (분리 정책 미적용)
 *   2. CUSTOMER-LEAK — customer_notes 안에 운영 키워드 포함 (W21 위반)
 *   3. FIXED-COMMISSION-MISSING — commission_rate=0 + fixed_amount=null (정액 의심)
 *   4. SHOPPING-NOT-SPECIFIED — itinerary_data.highlights.shopping 미설정 (FIELD_POLICY fallback 위험)
 *   5. AUDIT-STATUS-NULL — audit_status 컬럼이 null (레거시 — 재감사 대상)
 *   6. NOTICES-EMPTY — notices_parsed 가 빈 배열 또는 null
 *   7. NUMBER-COMMA-RESIDUE — inclusions/excludes 에 "2,000엔" 같은 숫자 콤마 미보호 split 잔해
 *
 * 사용:
 *   node db/audit_existing_packages.js                  # 전체 점검 리포트 (dry-run)
 *   node db/audit_existing_packages.js --id=<uuid>      # 특정 상품만
 *   node db/audit_existing_packages.js --status=active  # 특정 상태만
 *   node db/audit_existing_packages.js --json           # JSON 출력 (CI/검증용)
 *
 * 자동 수정 (안전한 것만):
 *   node db/audit_existing_packages.js --fix-split-notes  # special_notes → internal_notes 백필
 *
 * 위험한 자동 수정은 거부 — 사장님이 어드민에서 직접 처리.
 */

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { id: null, status: null, json: false, fixSplitNotes: false };
  for (const a of args) {
    if (a.startsWith('--id=')) out.id = a.slice('--id='.length);
    else if (a.startsWith('--status=')) out.status = a.slice('--status='.length);
    else if (a === '--json') out.json = true;
    else if (a === '--fix-split-notes') out.fixSplitNotes = true;
  }
  return out;
}

function loadEnv() {
  const envFile = fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf-8');
  const env = {};
  envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
  return env;
}

// FIELD_POLICY.md 와 동일한 운영 키워드 (W21)
const INTERNAL_KEYWORDS_RE = /(?:커미션|정산|랜드사\s*협의|랜드사\s*마진|commission_rate|LAND_OPERATOR|마진\s*\d|매입가|원가|정액|네트가)/i;

// 숫자 콤마 split 잔해 — "2|000엔" 같은 패턴
function hasNumberCommaResidue(items) {
  if (!Array.isArray(items)) return false;
  const re = /\b\d+\s*\|\s*\d{3}\b/;
  return items.some(it => typeof it === 'string' && re.test(it));
}

function auditPackage(p) {
  const issues = [];

  // 1. SPLIT-NOTES
  if (p.special_notes && !p.customer_notes && !p.internal_notes) {
    issues.push({
      code: 'SPLIT-NOTES',
      severity: 'medium',
      msg: 'special_notes 만 사용 (customer/internal 미분리)',
      autoFixable: true,
      currentValue: (p.special_notes || '').slice(0, 80) + (p.special_notes?.length > 80 ? '...' : ''),
    });
  }

  // 2. CUSTOMER-LEAK
  if (p.customer_notes && INTERNAL_KEYWORDS_RE.test(p.customer_notes)) {
    issues.push({
      code: 'CUSTOMER-LEAK',
      severity: 'high',
      msg: 'customer_notes 안에 운영 키워드 (커미션/정산/마진 등)',
      autoFixable: false,
      currentValue: p.customer_notes.slice(0, 80),
    });
  }

  // 3. FIXED-COMMISSION-MISSING — commission_rate=0 인데 fixed_amount 도 null
  //    (정액 마진 가능성 — 수기 확인 필요)
  if (p.commission_rate === 0 && (p.commission_fixed_amount == null || p.commission_fixed_amount === 0)) {
    issues.push({
      code: 'FIXED-COMMISSION-MISSING',
      severity: 'low',
      msg: 'commission_rate=0 + commission_fixed_amount=null — 정액 마진이라면 컬럼 백필 필요',
      autoFixable: false,
    });
  }

  // 4. SHOPPING-NOT-SPECIFIED
  const shopping = p.itinerary_data?.highlights?.shopping;
  if (shopping == null) {
    issues.push({
      code: 'SHOPPING-NOT-SPECIFIED',
      severity: 'medium',
      msg: 'itinerary_data.highlights.shopping 미설정 — A4/모바일 fallback 누출 위험',
      autoFixable: false,
    });
  }

  // 5. AUDIT-STATUS-NULL (레거시 — 재감사 권장)
  if (p.audit_status == null) {
    issues.push({
      code: 'AUDIT-STATUS-NULL',
      severity: 'low',
      msg: 'audit_status 컬럼 null (post_register_audit 미실행)',
      autoFixable: false,
    });
  }

  // 6. NOTICES-EMPTY
  if (!Array.isArray(p.notices_parsed) || p.notices_parsed.length === 0) {
    issues.push({
      code: 'NOTICES-EMPTY',
      severity: 'medium',
      msg: 'notices_parsed 비어있음 — 유의사항 표시 안 됨',
      autoFixable: false,
    });
  }

  // 7. NUMBER-COMMA-RESIDUE
  if (hasNumberCommaResidue(p.inclusions) || hasNumberCommaResidue(p.excludes)) {
    issues.push({
      code: 'NUMBER-COMMA-RESIDUE',
      severity: 'high',
      msg: 'inclusions/excludes 에 숫자 콤마 split 잔해 ("2|000엔")',
      autoFixable: false,
    });
  }

  return issues;
}

async function main() {
  const args = parseArgs();
  const env = loadEnv();
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const FIELDS = [
    'id', 'short_code', 'title', 'destination', 'status', 'audit_status',
    'commission_rate', 'commission_fixed_amount', 'commission_currency',
    'special_notes', 'customer_notes', 'internal_notes',
    'itinerary_data', 'notices_parsed', 'inclusions', 'excludes',
    'created_at',
  ].join(', ');

  let q = sb.from('travel_packages').select(FIELDS).neq('status', 'archived');
  if (args.id) q = q.eq('id', args.id);
  if (args.status) q = q.eq('status', args.status);
  q = q.order('created_at', { ascending: true });

  const { data, error } = await q;
  if (error) { console.error('❌', error.message); process.exit(1); }

  const pkgs = data || [];

  const summary = {
    total: pkgs.length,
    clean: 0,
    issuesByCode: {},
    issuesBySeverity: { high: 0, medium: 0, low: 0 },
    perPackage: [],
  };

  for (const p of pkgs) {
    const issues = auditPackage(p);
    if (issues.length === 0) {
      summary.clean++;
      continue;
    }
    for (const i of issues) {
      summary.issuesByCode[i.code] = (summary.issuesByCode[i.code] || 0) + 1;
      summary.issuesBySeverity[i.severity] = (summary.issuesBySeverity[i.severity] || 0) + 1;
    }
    summary.perPackage.push({
      id: p.id,
      short_code: p.short_code,
      title: (p.title || '').slice(0, 50),
      status: p.status,
      issues,
    });
  }

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  // 한 화면 리포트
  console.log('═'.repeat(72));
  console.log(` 기존 상품 일괄 감사 — ${pkgs.length}건 점검`);
  console.log('═'.repeat(72));
  console.log(`✅ 무문제 (clean): ${summary.clean}건`);
  console.log(`⚠️  문제 있음:    ${pkgs.length - summary.clean}건`);
  console.log();
  console.log('심각도 분포:');
  console.log(`   🔴 high:    ${summary.issuesBySeverity.high}건`);
  console.log(`   🟡 medium:  ${summary.issuesBySeverity.medium}건`);
  console.log(`   ⚪ low:     ${summary.issuesBySeverity.low}건`);
  console.log();
  console.log('코드별 분포:');
  const sortedCodes = Object.entries(summary.issuesByCode).sort((a, b) => b[1] - a[1]);
  for (const [code, n] of sortedCodes) console.log(`   ${code.padEnd(28)} ${n}건`);
  console.log();

  if (summary.perPackage.length > 0) {
    console.log('상위 위험 상품 (high severity):');
    const highRisk = summary.perPackage.filter(pp => pp.issues.some(i => i.severity === 'high'));
    if (highRisk.length === 0) {
      console.log('   (없음)');
    } else {
      for (const pp of highRisk.slice(0, 20)) {
        console.log(`\n   📦 ${pp.short_code} — ${pp.title}`);
        console.log(`      status=${pp.status}  id=${pp.id}`);
        for (const i of pp.issues.filter(x => x.severity === 'high')) {
          console.log(`      🔴 [${i.code}] ${i.msg}`);
          if (i.currentValue) console.log(`         현재: "${i.currentValue}"`);
        }
      }
    }
  }

  // 자동 수정: SPLIT-NOTES
  if (args.fixSplitNotes) {
    const targets = summary.perPackage
      .filter(pp => pp.issues.some(i => i.code === 'SPLIT-NOTES' && i.autoFixable));
    console.log(`\n🔧 SPLIT-NOTES 자동 수정 대상: ${targets.length}건`);

    let fixed = 0;
    for (const pp of targets) {
      const orig = pkgs.find(x => x.id === pp.id);
      if (!orig) continue;
      // 안전 분기: special_notes 에 운영 키워드가 있으면 internal_notes 로, 없으면 customer_notes 로
      const isInternal = INTERNAL_KEYWORDS_RE.test(orig.special_notes || '');
      const updates = {};
      if (isInternal) updates.internal_notes = orig.special_notes;
      else updates.customer_notes = orig.special_notes;
      const { error: upErr } = await sb.from('travel_packages').update(updates).eq('id', pp.id);
      if (upErr) {
        console.log(`   ❌ ${pp.short_code}: ${upErr.message}`);
      } else {
        fixed++;
        console.log(`   ✅ ${pp.short_code} → ${isInternal ? 'internal_notes' : 'customer_notes'} 백필`);
      }
    }
    console.log(`\n   완료: ${fixed}/${targets.length}건`);
  }

  console.log('\n다음 단계:');
  console.log('   • 자동 수정 가능: node db/audit_existing_packages.js --fix-split-notes');
  console.log('   • 위험 항목(high)은 어드민에서 수기 처리 — JSON 출력으로 작업 큐 만들기:');
  console.log('     node db/audit_existing_packages.js --json > scratch/audit_existing.json');

  // exit code
  if (summary.issuesBySeverity.high > 0) process.exit(1);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
