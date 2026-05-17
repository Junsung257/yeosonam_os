/**
 * @file backfill_itinerary_llm.js
 *
 * 기존 패키지의 itinerary_data 를 LLM 으로 재추출 + UPDATE.
 *
 * 대상:
 *   - default: status IN ('approved', 'pending_review') 만 (활성 패키지)
 *   - --include-archived: archived 패키지도 포함 (322건 + 활성 6건)
 *   - --package-id=<uuid>: 단일 패키지만 (테스트용)
 *
 * 사용:
 *   node db/backfill_itinerary_llm.js              # dry-run, 활성만 (변경 없음)
 *   node db/backfill_itinerary_llm.js --apply      # 실제 적용
 *   node db/backfill_itinerary_llm.js --apply --include-archived
 *   node db/backfill_itinerary_llm.js --package-id=7f485215-... --apply
 *
 * 비용:
 *   - 패키지 1개당 ~$0.001 (DeepSeek Flash + prompt cache)
 *   - 활성 6건: ~$0.006
 *   - archived 322 포함: ~$0.33
 *
 * 안전:
 *   - 매칭률 90% 이상 이미 잘 매칭된 패키지는 skip (skipIfMatchRateAbove: 0.9)
 *   - LLM 실패 시 기존 itinerary_data 보존
 *   - concurrent 5 로 제한 (DeepSeek rate limit 보호)
 */

const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [k, ...rest] = line.split('=');
    if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
}

const APPLY = process.argv.includes('--apply');
const INCLUDE_ARCHIVED = process.argv.includes('--include-archived');
const PKG_ID_ARG = process.argv.find(a => a.startsWith('--package-id='));
const PKG_ID = PKG_ID_ARG ? PKG_ID_ARG.split('=')[1] : null;
const CONCURRENT = 5;

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // 대상 패키지 fetch
  let query = sb.from('travel_packages').select('id, title, destination, status').not('raw_text', 'is', null);
  if (PKG_ID) {
    query = query.eq('id', PKG_ID);
  } else {
    const statuses = INCLUDE_ARCHIVED
      ? ['approved', 'pending_review', 'archived']
      : ['approved', 'pending_review'];
    query = query.in('status', statuses);
  }
  const { data: pkgs, error } = await query;
  if (error) { console.error('fetch 실패:', error.message); process.exit(1); }
  if (!pkgs?.length) { console.log('대상 패키지 0건'); process.exit(0); }

  console.log(`\n🤖 LLM itinerary re-extract backfill`);
  console.log(`  모드: ${APPLY ? '✅ APPLY' : '🔍 DRY-RUN (변경 없음)'}`);
  console.log(`  대상: ${pkgs.length}건 (archived ${INCLUDE_ARCHIVED ? '포함' : '제외'})`);
  console.log(`  예상 비용: ~$${(pkgs.length * 0.001).toFixed(3)} (DeepSeek Flash)`);
  console.log('');

  if (!APPLY) {
    console.log('  → 실제 적용은 --apply 플래그로');
    console.log('  대상 sample:');
    for (const p of pkgs.slice(0, 5)) console.log(`    ${p.id.slice(0, 8)} [${p.status}] ${p.destination} — ${p.title?.slice(0, 50)}`);
    process.exit(0);
  }

  // tsx 로 TS 모듈 import (Next.js 환경 아니라 직접 호출)
  require('tsx/cjs');
  const { reExtractAndUpdateItineraryByPackageId } = require('../src/lib/itinerary-llm-extractor.ts');

  let okCount = 0, skipCount = 0, failCount = 0;
  const results = [];

  // concurrent N 처리
  for (let i = 0; i < pkgs.length; i += CONCURRENT) {
    const batch = pkgs.slice(i, i + CONCURRENT);
    const batchResults = await Promise.all(batch.map(async (p) => {
      try {
        const r = await reExtractAndUpdateItineraryByPackageId(p.id, { skipIfMatchRateAbove: 0.9 });
        return { pkg: p, r };
      } catch (e) {
        return { pkg: p, r: { ok: false, reason: e.message } };
      }
    }));
    for (const { pkg, r } of batchResults) {
      if (r.ok && r.reason === 'skip-already-high-match') {
        skipCount++;
        console.log(`  ⊘ skip (이미 ${(r.matchRate * 100).toFixed(0)}%) ${pkg.id.slice(0, 8)} ${pkg.destination}`);
      } else if (r.ok) {
        okCount++;
        const before = ((r.before ?? 0) * 100).toFixed(0);
        const after = ((r.after ?? 0) * 100).toFixed(0);
        console.log(`  ✓ ${before}% → ${after}% ${pkg.id.slice(0, 8)} ${pkg.destination} — ${pkg.title?.slice(0, 40)}`);
      } else {
        failCount++;
        console.log(`  ✗ ${r.reason} ${pkg.id.slice(0, 8)} ${pkg.destination}`);
      }
      results.push({ pkg, r });
    }
  }

  console.log(`\n📊 결과: ${okCount} 적용, ${skipCount} skip, ${failCount} 실패 (총 ${pkgs.length})`);
  process.exit(failCount > 0 ? 2 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
