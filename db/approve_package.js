#!/usr/bin/env node
/**
 * @file db/approve_package.js
 * @description audit_status=clean 인 상품을 status='active' 로 승격 (CLI).
 *
 * 용도: post_register_audit 이후 Agent 가 호출. /api/packages/[id]/approve 와 동일 로직이지만
 *        dev 서버가 죽어도 작동 (Supabase 직접 UPDATE).
 *
 * 사용:
 *   node db/approve_package.js <id1> <id2> ...          # clean 만 자동 승인
 *   node db/approve_package.js --force <id1> <id2> ...  # warnings 도 강제 승인
 *
 * 종료 코드:
 *   0 — 전체 성공
 *   1 — 최소 1개 이상 실패 또는 gate (blocked / warnings without --force)
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnv() {
  const envFile = fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf-8');
  const env = {};
  envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
  return env;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CUSTOMER_VISIBLE_APPROVAL_AUDITS = new Set(['clean', 'info']);
const REQUIRED_MOBILE_PROOF_SURFACES = ['packages', 'lp'];

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function getStoredCustomerOpenContract(auditReport) {
  const report = asRecord(auditReport);
  return asRecord(report?.customer_open_contract)
    || asRecord(asRecord(report?.upload_to_open_autopilot)?.customer_open_contract)
    || null;
}

function extractCustomerMobileProof(auditReport) {
  const report = asRecord(auditReport);
  return asRecord(report?.mobile_browser_proof)
    || asRecord(report?.customer_mobile_proof)
    || asRecord(report?.mobile_landing_proof)
    || null;
}

function listProofSurfaces(proof) {
  const surfaces = new Set(Array.isArray(proof?.surfaces) ? proof.surfaces.map(String) : []);
  if (Array.isArray(proof?.surface_results)) {
    for (const result of proof.surface_results) {
      const surface = asRecord(result)?.surface;
      if (surface) surfaces.add(String(surface));
    }
  }
  return surfaces;
}

function mobileProofBlocker(pkg) {
  const proof = extractCustomerMobileProof(pkg.audit_report);
  if (!proof) return 'mobile_browser_proof is missing';
  if (proof.status !== 'pass') return `mobile_browser_proof status=${proof.status ?? 'missing'}`;
  if (proof.source !== 'hwp-mobile-browser-proof') return `mobile_browser_proof source=${proof.source ?? 'missing'}`;
  if (!proof.checked_at || !proof.screen_hash || !proof.customer_visible_hash) {
    return 'mobile_browser_proof checked_at or hashes are missing';
  }
  const surfaces = listProofSurfaces(proof);
  for (const surface of REQUIRED_MOBILE_PROOF_SURFACES) {
    if (!surfaces.has(surface)) return `mobile_browser_proof ${surface} surface is missing`;
  }
  const surfaceResults = Array.isArray(proof.surface_results) ? proof.surface_results : [];
  for (const surface of REQUIRED_MOBILE_PROOF_SURFACES) {
    const result = surfaceResults.map(asRecord).find(item => item?.surface === surface);
    if (!result) return `mobile_browser_proof ${surface} surface result is missing`;
    if (result.status !== 'pass') return `mobile_browser_proof ${surface} status=${result.status ?? 'missing'}`;
    if (!result.screen_hash || !result.customer_visible_hash) {
      return `mobile_browser_proof ${surface} hashes are missing`;
    }
  }
  if (pkg.updated_at && proof.package_updated_at && proof.package_updated_at !== pkg.updated_at) {
    return 'mobile_browser_proof is stale for the current package row';
  }
  return null;
}

function optionalTourText(item) {
  if (typeof item === 'string') return item;
  const record = asRecord(item);
  if (!record) return '';
  return [record.name, record.price, record.note]
    .filter(value => value !== null && value !== undefined && String(value).trim())
    .map(String)
    .join(' ');
}

function hasOptionalTourDisplayPollution(optionalTours) {
  if (!Array.isArray(optionalTours)) return false;
  return optionalTours.some(item => {
    const text = optionalTourText(item).replace(/\s+/g, ' ').trim();
    const compact = text.replace(/\s+/g, '');
    return Boolean(text) && (
      /노\s*옵션|no\s*option|선택\s*관광\s*(?:없음|무|0)/iu.test(text)
      || /포\s*함\s*내\s*역|포함내역|불포함내역|차량|가이드|기사|숙박료|식사|관광지\s*입장료|여행자\s*보험|유류할증료/iu.test(text)
      || /상품가|예약금|최저가|\d[\d,]*\s*원\s*\/?\s*인|원\/인/iu.test(text)
      || /출발일|^\d{1,3}$|^\d{1,2}\/\d{1,2}$|^\d{1,2}월\d{1,2}일?$/iu.test(compact)
    );
  });
}

function collectBrokenAttractionIds(value) {
  const broken = new Set();
  const visit = node => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const record = asRecord(node);
    if (!record) return;
    if (Array.isArray(record.attraction_ids)) {
      for (const id of record.attraction_ids) {
        if (typeof id === 'string' && id.trim() && !UUID_RE.test(id.trim())) {
          broken.add(id.trim());
        }
      }
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return [...broken];
}

function getApprovalBlockers(pkg, options = {}) {
  const force = options.force === true;
  const blockers = [];
  if (pkg.audit_status === 'blocked') {
    blockers.push('audit_status=blocked');
  } else if (pkg.audit_status === 'warnings' && !force) {
    blockers.push('audit_status=warnings requires --force');
  } else if (!CUSTOMER_VISIBLE_APPROVAL_AUDITS.has(pkg.audit_status) && !(pkg.audit_status === 'warnings' && force)) {
    blockers.push(`audit_status=${pkg.audit_status ?? 'null'} is not approvable`);
  }

  const contract = getStoredCustomerOpenContract(pkg.audit_report);
  if (!contract) {
    blockers.push('customer_open_contract is missing');
  } else {
    const contractPass = contract.ok === true || contract.status === 'pass';
    if (!contractPass) blockers.push('customer_open_contract is not pass');
    if (contract.stale_or_missing_proof) blockers.push('customer_open_contract has stale_or_missing_proof');
    const contractMobileProof = asRecord(contract.mobile_browser_proof);
    if (contractMobileProof?.ok === false) {
      blockers.push(`customer_open_contract mobile proof failed: ${contractMobileProof.reason ?? 'unknown reason'}`);
    }
  }

  const proofBlocker = mobileProofBlocker(pkg);
  if (proofBlocker) blockers.push(proofBlocker);
  if (hasOptionalTourDisplayPollution(pkg.optional_tours)) {
    blockers.push('optional_tours contains customer-visible pollution');
  }
  const brokenAttractionIds = collectBrokenAttractionIds(pkg.itinerary_data);
  if (brokenAttractionIds.length > 0) {
    blockers.push(`itinerary_data has invalid attraction_ids: ${brokenAttractionIds.slice(0, 3).join(', ')}`);
  }
  return blockers;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const ids = args.filter(a => !a.startsWith('--'));

  if (ids.length === 0) {
    console.error('사용: node db/approve_package.js [--force] <id1> <id2> ...');
    process.exit(2);
  }

  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  let failures = 0;
  const promoted = [];

  for (const id of ids) {
    const { data, error } = await sb
      .from('travel_packages')
      .select('id, short_code, title, audit_status, audit_report, status, internal_code, updated_at, optional_tours, itinerary_data')
      .eq('id', id)
      .limit(1);
    if (error || !data?.[0]) {
      console.log(`❌ ${id}: fetch 실패 — ${error?.message || '상품 없음'}`);
      failures++;
      continue;
    }
    const p = data[0];

    // P0 public-contract gate (2026-07-08): audit_status is not enough.
    // Legacy CLI approvals must require the same customer_open_contract,
    // fresh /packages + /lp mobile proof, clean optional tours, and valid attraction ids.
    const blockers = getApprovalBlockers(p, { force });
    if (blockers.length > 0) {
      console.log(`??${p.short_code}: public approval blocked`);
      blockers.slice(0, 8).forEach(reason => console.log(`   - ${reason}`));
      failures++;
      continue;
    }

    if (p.audit_status === 'blocked') {
      console.log(`❌ ${p.short_code}: blocked — 수정 후 post_register_audit 재실행 필요`);
      failures++;
      continue;
    }
    // P0 #2 (2026-04-27): info 는 자동 승인 (안내성 W-code 만 존재). warnings 는 force 필요.
    if (p.audit_status === 'warnings' && !force) {
      console.log(`⚠️  ${p.short_code}: warnings — --force 필요`);
      failures++;
      continue;
    }
    if (p.status === 'active') {
      console.log(`ℹ️  ${p.short_code}: 이미 active (skip)`);
      continue;
    }

    const { error: updErr } = await sb
      .from('travel_packages')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (updErr) {
      console.log(`❌ ${p.short_code}: UPDATE 실패 ${updErr.message}`);
      failures++;
      continue;
    }
    if (p.internal_code) {
      await sb.from('products').update({ status: 'ACTIVE', updated_at: new Date().toISOString() }).eq('internal_code', p.internal_code);
    }
    console.log(`✅ ${p.short_code}: ${p.audit_status ?? 'null'} → active`);
    promoted.push(id);
  }

  // P1 #6 (2026-04-27): ISR 캐시 즉시 무효화 (best-effort, 실패해도 진행).
  if (promoted.length > 0 && !process.env.SKIP_REVALIDATE) {
    try {
      const { revalidatePackages } = require('./_revalidate');
      const result = await revalidatePackages(promoted);
      if (result.skipped) console.log(`ℹ️  ISR 무효화 스킵: ${result.skipped}`);
    } catch (e) {
      console.log(`ℹ️  ISR 무효화 헬퍼 로드 실패 (무시): ${e.message}`);
    }
  }

  // ERR-process-violation-dump-after-approve@2026-04-22:
  // active 승격 직후 판매 필드 풀덤프 자동 실행. approve 와 dump 가 분리돼 있어
  // Agent 가 force approve 후 재덤프를 매번 놓쳤던 사고 재발 방지.
  if (promoted.length > 0 && !process.env.SKIP_DUMP_RESULT) {
    const { spawnSync } = require('child_process');
    const dumpScript = path.resolve(__dirname, 'dump_package_result.js');
    if (fs.existsSync(dumpScript)) {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`  📋 승격 후 자동 덤프 (${promoted.length}건 — active 상태)`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      spawnSync('node', [dumpScript, ...promoted], { stdio: 'inherit' });
    }
  }

  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
