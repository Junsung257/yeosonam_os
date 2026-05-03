#!/usr/bin/env node
/**
 * attractions 에 mrt_gid 가 있으나 mrt_detail_fetch_queue 에 행이 없는 건만 pending 으로 적재.
 *
 * 사용법:
 *   node db/mrt_enqueue_missing.js [--dry-run]
 *
 * 환경: .env.local — SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const PAGE = 500;

function inferCategory(row) {
  if (row.mrt_category === 'stay' || row.mrt_category === 'tna') return row.mrt_category;
  if (row.badge_type === 'hotel') return 'stay';
  return 'tna';
}

function isActiveRow(row) {
  return row.is_active !== false;
}

async function loadQueueGidSet() {
  const set = new Set();
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('mrt_detail_fetch_queue')
      .select('mrt_gid')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const r of data) {
      if (r.mrt_gid) set.add(String(r.mrt_gid));
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return set;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const queueGids = await loadQueueGidSet();
  console.log(`큐에 이미 있는 mrt_gid: ${queueGids.size}개`);

  const missing = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('attractions')
      .select('mrt_gid, mrt_category, mrt_provider_url, badge_type, is_active')
      .not('mrt_gid', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;

    for (const row of data) {
      if (!isActiveRow(row)) continue;
      const gid = String(row.mrt_gid);
      if (queueGids.has(gid)) continue;
      missing.push({
        mrt_gid: gid,
        mrt_category: inferCategory(row),
        provider_url: row.mrt_provider_url ?? null,
        status: 'pending',
        updated_at: new Date().toISOString(),
      });
    }

    if (data.length < PAGE) break;
    from += PAGE;
  }

  console.log(`큐 누락(적재 대상): ${missing.length}건`);
  if (!missing.length) return;
  if (dryRun) {
    console.log('[dry-run] 샘플:', missing.slice(0, 5));
    return;
  }

  const BATCH = 200;
  let inserted = 0;
  for (let i = 0; i < missing.length; i += BATCH) {
    const chunk = missing.slice(i, i + BATCH);
    const { error } = await supabase.from('mrt_detail_fetch_queue').insert(chunk);
    if (error) {
      console.error(`[배치 오류] ${i}~: ${error.message}`);
      for (const row of chunk) {
        const { error: e2 } = await supabase.from('mrt_detail_fetch_queue').insert(row);
        if (e2 && !String(e2.message).includes('duplicate')) {
          console.error(`  ${row.mrt_gid}: ${e2.message}`);
        } else if (!e2) inserted++;
      }
    } else {
      inserted += chunk.length;
    }
  }
  console.log(`✓ insert 완료(성공 건수): ${inserted} / ${missing.length}`);
}

main().catch(e => {
  console.error('[치명적 오류]', e);
  process.exit(1);
});
