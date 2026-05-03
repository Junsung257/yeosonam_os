#!/usr/bin/env node
/**
 * MRT 상세 본문 수집 워커 (Phase 2)
 *
 * mrt_detail_fetch_queue 의 pending 행을 순차 처리해
 * attractions.mrt_raw_desc 를 채운다. (가공은 process_mrt_descriptions.js 배치)
 *
 * 사용법:
 *   node db/mrt_detail_worker.js [--limit 30] [--sleep-ms 1500]
 *
 * 환경: .env.local — SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const { fetchTnaDesc, fetchStayDesc, sleep } = require('./lib/mrt_mcp_shared');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

function parseArgs() {
  const a = process.argv.slice(2);
  let limit = 30;
  let sleepMs = 1500;
  const li = a.indexOf('--limit');
  if (li !== -1 && a[li + 1]) limit = Math.max(1, parseInt(a[li + 1], 10) || 30);
  const si = a.indexOf('--sleep-ms');
  if (si !== -1 && a[si + 1]) sleepMs = Math.max(0, parseInt(a[si + 1], 10) || 1500);
  return { limit, sleepMs };
}

async function run() {
  const { limit, sleepMs } = parseArgs();
  const iso = () => new Date().toISOString();

  const { data: jobs, error: qErr } = await supabase
    .from('mrt_detail_fetch_queue')
    .select('*')
    .eq('status', 'pending')
    // 재시도 건이 앞줄을 막지 않도록 신규(attempts 낮은 건) 우선 처리
    .order('attempts', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(limit);

  if (qErr) {
    console.error('[오류] 큐 조회:', qErr.message);
    process.exit(1);
  }
  if (!jobs?.length) {
    console.log('처리할 pending 작업이 없습니다.');
    return;
  }

  console.log(`상세 수집 시작: ${jobs.length}건 (sleep ${sleepMs}ms)`);

  for (const job of jobs) {
    const { error: lockErr } = await supabase
      .from('mrt_detail_fetch_queue')
      .update({ status: 'processing', updated_at: iso() })
      .eq('mrt_gid', job.mrt_gid)
      .eq('status', 'pending');
    if (lockErr) {
      console.warn(`[스킵] lock ${job.mrt_gid}: ${lockErr.message}`);
      continue;
    }

    let desc = null;
    try {
      if (job.mrt_category === 'tna') {
        desc = await fetchTnaDesc(job.mrt_gid, job.provider_url || '');
      } else if (job.mrt_category === 'stay') {
        desc = await fetchStayDesc(job.mrt_gid);
      } else {
        throw new Error(`알 수 없는 mrt_category: ${job.mrt_category}`);
      }

      if (!desc || !String(desc).trim()) {
        throw new Error('빈 상세 응답');
      }

      const patch = {
        mrt_raw_desc: desc,
        ai_processed_at: null,
      };
      if (job.provider_url) patch.mrt_provider_url = job.provider_url;

      const { error: upAttr } = await supabase
        .from('attractions')
        .update(patch)
        .eq('mrt_gid', job.mrt_gid);
      if (upAttr) throw new Error(upAttr.message);

      await supabase
        .from('mrt_detail_fetch_queue')
        .update({ status: 'done', last_error: null, updated_at: iso() })
        .eq('mrt_gid', job.mrt_gid);

      console.log(`  ✓ ${job.mrt_gid} (${job.mrt_category})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const attempts = (job.attempts ?? 0) + 1;
      const isEmptyDesc = msg.includes('빈 상세 응답');
      // 빈 응답은 같은 결과가 반복되는 경우가 많아 조기 실패 처리
      const failed = isEmptyDesc || attempts >= 5;
      await supabase
        .from('mrt_detail_fetch_queue')
        .update({
          status: failed ? 'failed' : 'pending',
          attempts,
          last_error: msg.slice(0, 500),
          updated_at: iso(),
        })
        .eq('mrt_gid', job.mrt_gid);
      console.warn(`  ✗ ${job.mrt_gid}: ${msg} (시도 ${attempts}/5)`);
    }

    if (sleepMs > 0) await sleep(sleepMs);
  }

  console.log('워커 배치 종료.');
}

run().catch(err => {
  console.error('[치명적 오류]', err);
  process.exit(1);
});
