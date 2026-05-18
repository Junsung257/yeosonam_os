/**
 * @file mrt-lazy-sync.ts — MRT 3-Tier Hybrid 의 Tier 2 (Lazy On-Demand) 구현 (2026-05-14 박제)
 *
 * Tier 1 (Eager): db/sync_mrt_attractions.js 가 주력 destination 30 개를 cron 으로 sync.
 * Tier 2 (Lazy): 사장님이 새 destination 등록 시 백그라운드로 MRT TNA 동기화 트리거.
 * Tier 3 (Wikidata): MRT 에도 없으면 wikidata-poi.ts fallback (별도 모듈).
 *
 * 동작:
 *   1. 등록 직후 destination 의 MRT canonical attraction 수가 임계값(5) 미만이면
 *   2. 백그라운드로 sync 트리거 (fire-and-forget, 등록 흐름 지연 0)
 *   3. 다음 등록부터 MRT canonical 매칭 가능
 *
 * 안전: 24시간 안에 동일 destination sync 시도 안 함 (mrt_sync_attempts 캐싱). 무한 호출 방지.
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { spawn } from 'node:child_process';
import path from 'node:path';

const MIN_MRT_ATTRACTIONS = 5;
const SYNC_COOLDOWN_HOURS = 24;
// 동일 프로세스 안에서 짧은 시간(2분)에 동일 destination 중복 호출 방지
const _inflightCooldown = new Map<string, number>();
const INFLIGHT_COOLDOWN_MS = 2 * 60 * 1000;

// 2026-05-19 박제 (B1): serverless skip 누적 카운터 — Tier 1 cron 미가동 또는 누락 가시화.
//   SF-1/SF-4 와 동일 패턴 (10회 + 30분 cooldown).
const serverlessSkipState = {
  consecutive: 0,
  lastAlertAt: 0,
  ALERT_THRESHOLD: 10,
  ALERT_COOLDOWN_MS: 30 * 60 * 1000,
};
function reportServerlessSkip(destination: string): void {
  serverlessSkipState.consecutive++;
  if (serverlessSkipState.consecutive < serverlessSkipState.ALERT_THRESHOLD) return;
  if (Date.now() - serverlessSkipState.lastAlertAt < serverlessSkipState.ALERT_COOLDOWN_MS) return;
  serverlessSkipState.lastAlertAt = Date.now();
  if (!isSupabaseConfigured) return;
  supabaseAdmin.from('admin_alerts').insert({
    category: 'register-learning',
    severity: 'info',
    title: `MRT lazy-sync ${serverlessSkipState.consecutive}회 serverless skip`,
    message: `serverless 환경(Vercel)에서 ${serverlessSkipState.consecutive}회 destination MRT sync 큐 적재됨. Tier 1 cron(db/sync_mrt_attractions.js) 정상 작동 확인 필요. 최근 destination: ${destination}`,
    ref_type: 'parser',
    ref_id: null,
    meta: { phase: 'mrt-lazy-sync', consecutive: serverlessSkipState.consecutive, last_destination: destination },
  }).then(() => {}, () => {});
  serverlessSkipState.consecutive = 0;
}

/**
 * destination 의 MRT canonical attraction 수를 확인하고 부족하면 백그라운드 sync 트리거.
 * 호출 측은 await 안 함 — fire-and-forget. 등록 흐름 지연 0.
 */
export async function maybeTriggerMrtSync(destination: string | null | undefined): Promise<void> {
  if (!destination || !isSupabaseConfigured) return;
  const dest = destination.trim();
  if (!dest) return;

  // 동일 프로세스 in-flight 차단
  const now = Date.now();
  const last = _inflightCooldown.get(dest);
  if (last && now - last < INFLIGHT_COOLDOWN_MS) return;
  _inflightCooldown.set(dest, now);

  try {
    // 1) destination 의 MRT canonical attraction 수 확인
    //    destination 은 도시명(예: "후쿠오카") — attractions.country 는 ISO2 (JP) 라 region 매칭으로 시도
    const { count } = await supabaseAdmin
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .not('mrt_gid', 'is', null)
      .or(`region.ilike.%${dest}%,name.ilike.%${dest}%`);

    if ((count ?? 0) >= MIN_MRT_ATTRACTIONS) {
      return; // 이미 충분
    }

    // 2) cooldown 체크 (DB) — mrt_sync_attempts 테이블에서 24h 안의 시도 있으면 skip
    const since = new Date(now - SYNC_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
    const { count: recentAttempts } = await supabaseAdmin
      .from('mrt_sync_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('destination', dest)
      .gte('attempted_at', since);

    if ((recentAttempts ?? 0) > 0) {
      console.log(`[MRT-Lazy] ${dest} 24h 내 sync 시도 있음 — skip`);
      return;
    }

    // 3) 시도 기록 INSERT (성공·실패 모두 cooldown 보장)
    await supabaseAdmin
      .from('mrt_sync_attempts')
      .insert({ destination: dest, attempted_at: new Date().toISOString(), status: 'queued' })
      .then(undefined, () => {});

    // 4) 백그라운드 sync spawn — db/sync_mrt_attractions.js 호출 (이미 박힌 도구 재활용)
    //    Vercel/serverless 환경에서는 spawn 불가 — 개발/self-hosted 환경에서만 작동.
    //    Production 은 cron 으로 Tier 1 가 보완.
    if (process.env.NODE_ENV === 'production' && process.env.VERCEL) {
      console.log(`[MRT-Lazy] ${dest} sync 큐에 적재 (serverless 환경 — Tier 1 cron 이 처리)`);
      // 2026-05-19 박제 (B1): 누적 임계치 시 admin_alerts — Tier 1 cron 모니터링.
      reportServerlessSkip(dest);
      return;
    }

    try {
      const scriptPath = path.resolve(process.cwd(), 'db', 'sync_mrt_attractions.js');
      const proc = spawn('node', [scriptPath, '--destination', dest], {
        detached: true,
        stdio: 'ignore',
      });
      proc.unref();
      console.log(`[MRT-Lazy] ${dest} 백그라운드 sync 트리거 (PID ${proc.pid})`);
    } catch (e) {
      console.warn(`[MRT-Lazy] ${dest} spawn 실패 (무시):`, e instanceof Error ? e.message : e);
    }
  } catch (e) {
    console.warn(`[MRT-Lazy] ${dest} 처리 실패 (무시):`, e instanceof Error ? e.message : e);
  }
}
