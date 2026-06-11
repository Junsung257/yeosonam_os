/**
 * 어셈블러 자동 부트스트랩 후보 식별 cron (2026-05-14 박제)
 *
 * 동작:
 *   1. travel_packages 에서 destination 별 등록 수 집계
 *   2. N >= 3 이면서 db/assembler_*.js 가 없는 destination 식별 (HAN/FUK/CEB 같은 stub 만 있는 경우 포함)
 *   3. 후보 목록을 bootstrap_candidates 테이블에 INSERT (어드민 알림용)
 *   4. dev/self-hosted 환경이면 db/auto_bootstrap_assembler.js 자동 spawn (사장님 검수 큐로)
 *
 * Vercel serverless 환경에서는 spawn 불가 — 후보 식별만 + 사장님이 dev 에서 수동 spawn.
 *
 * GET /api/cron/bootstrap-assembler?secret=CRON_SECRET[&dryRun=1]
 */
import { NextRequest } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

const MIN_PACKAGES = 3;

// 이미 어셈블러가 박혀있는 지역 → 부트스트랩 대상 제외
const EXISTING_ASSEMBLERS = ['danang', 'xian', 'qingdao', 'bho'];
// destination 한국어 → 어셈블러 slug 매핑 (DEST_CODE 기반)
const DEST_TO_SLUG: Record<string, string> = {
  '다낭': 'danang', '서안': 'xian', '청도': 'qingdao', '칭다오': 'qingdao',
  '보홀': 'bho', '하노이': 'han', '후쿠오카': 'fuk', '세부': 'ceb',
  '오사카': 'osa', '도쿄': 'tyo', '삿포로': 'cts', '나트랑': 'cxr',
  '푸꾸옥': 'pqc', '방콕': 'bkk', '치앙마이': 'cnx', '장가계': 'dyg',
  '북경': 'pek', '상해': 'sha', '계림': 'kwl', '황산': 'hfe',
  '대만': 'tpe', '타이베이': 'tpe',
};
const DEST_TO_CODE: Record<string, string> = {
  '다낭': 'DAD', '서안': 'XIY', '청도': 'TAO', '칭다오': 'TAO',
  '보홀': 'BHO', '하노이': 'HAN', '후쿠오카': 'FUK', '세부': 'CEB',
  '오사카': 'OSA', '도쿄': 'TYO', '삿포로': 'CTS', '나트랑': 'CXR',
  '푸꾸옥': 'PQC', '방콕': 'BKK', '치앙마이': 'CNX', '장가계': 'DYG',
  '북경': 'PEK', '상해': 'SHA', '계림': 'KWL', '황산': 'HFE',
  '대만': 'TPE', '타이베이': 'TPE',
};

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function assemblerFileExists(slug: string): boolean {
  const fullPath = path.resolve(process.cwd(), 'db', `assembler_${slug}.js`);
  return fs.existsSync(fullPath);
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured) return apiResponse({ ok: true, message: 'DB not configured' });

  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';
  const startedAt = new Date().toISOString();

  try {
    // 1) destination 별 등록 수 집계
    const { data: counts, error } = await supabaseAdmin
      .from('travel_packages')
      .select('destination')
      .not('destination', 'is', null);
    if (error) throw error;

    const tally = new Map<string, number>();
    for (const row of (counts ?? []) as { destination: string }[]) {
      const dest = (row.destination ?? '').trim().split(/[\/,]/)[0].trim();
      if (!dest) continue;
      tally.set(dest, (tally.get(dest) ?? 0) + 1);
    }

    // 2) 후보 식별 — count >= 3 + 어셈블러 미존재
    const candidates: Array<{
      destination: string;
      packages: number;
      slug: string | null;
      destCode: string | null;
      action: 'bootstrap' | 'manual_review';
    }> = [];

    for (const [dest, n] of tally.entries()) {
      if (n < MIN_PACKAGES) continue;
      const slug = DEST_TO_SLUG[dest] ?? null;
      if (slug && EXISTING_ASSEMBLERS.includes(slug)) continue;
      if (slug && assemblerFileExists(slug)) continue;
      candidates.push({
        destination: dest,
        packages: n,
        slug,
        destCode: DEST_TO_CODE[dest] ?? null,
        action: slug && DEST_TO_CODE[dest] ? 'bootstrap' : 'manual_review',
      });
    }
    candidates.sort((a, b) => b.packages - a.packages);

    if (dryRun) {
      return apiResponse({
        ok: true,
        dryRun: true,
        startedAt,
        candidates,
        existing_assemblers: EXISTING_ASSEMBLERS,
      });
    }

    // 3) dev/self-hosted 면 spawn — Vercel 은 후보 식별만
    const isServerless = process.env.NODE_ENV === 'production' && !!process.env.VERCEL;
    const triggered: string[] = [];
    const queuedOnly: string[] = [];

    for (const c of candidates) {
      if (!c.slug || !c.destCode || isServerless) {
        queuedOnly.push(c.destination);
        continue;
      }
      try {
        const scriptPath = path.resolve(process.cwd(), 'db', 'auto_bootstrap_assembler.js');
        const proc = spawn(
          'node',
          [scriptPath, `--region=${c.destination}`, `--dest-code=${c.destCode}`, `--slug=${c.slug}`, `--min=${MIN_PACKAGES}`],
          { detached: true, stdio: 'ignore' },
        );
        proc.unref();
        triggered.push(c.destination);
      } catch (e) {
        console.warn(`[Bootstrap] ${c.destination} spawn failed:`, sanitizeDbError(e));
        queuedOnly.push(c.destination);
      }
    }

    return apiResponse({
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      isServerless,
      candidates_total: candidates.length,
      triggered,
      queued_only: queuedOnly,
    });
  } catch (err) {
    return apiResponse(
      { ok: false, error: sanitizeDbError(err) },
      { status: 500 },
    );
  }
}
