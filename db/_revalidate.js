/**
 * ISR 캐시 무효화 헬퍼 (P1 #6, 2026-04-27)
 *
 * DB 직접 수정(approve_package.js, manual update) 후 모바일 랜딩 페이지가
 * 1시간 ISR 만료를 기다리지 않고 즉시 갱신되도록 best-effort 호출.
 *
 * 사용법:
 *   const { revalidatePackages } = require('./_revalidate');
 *   await revalidatePackages([id1, id2]);   // 실패해도 throw 안 함 (graceful)
 *
 * 호출 대상:
 *   - localhost:3000 (dev 서버 켜져 있을 때)
 *   - process.env.PUBLIC_SITE_URL (production)
 *
 * 실패 시: graceful skip + 1줄 안내 로그. 등록 프로세스는 막지 않음.
 */

const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return {};
  const env = {};
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(l => {
    const [k, ...v] = l.split('=');
    if (k && !k.startsWith('#')) env[k.trim()] = v.join('=').trim();
  });
  return env;
}

function isPlaceholder(secret) {
  if (!secret) return true;
  // 한글/공백 포함 placeholder 의심
  if (/[가-힣\s]/.test(secret)) return true;
  if (secret.length < 16) return true;
  return false;
}

/**
 * @param {string[]} packageIds
 * @returns {Promise<{ ok: number, skipped: string|null }>}
 */
async function revalidatePackages(packageIds) {
  if (!packageIds || packageIds.length === 0) return { ok: 0, skipped: '대상 없음' };

  const env = loadEnv();
  const secret = env.REVALIDATE_SECRET;
  if (isPlaceholder(secret)) {
    return { ok: 0, skipped: 'REVALIDATE_SECRET 미설정 또는 placeholder — production env 설정 필요' };
  }

  const paths = ['/packages', ...packageIds.map(id => `/packages/${id}`)];
  const targets = [];
  if (env.PUBLIC_SITE_URL) targets.push(env.PUBLIC_SITE_URL.replace(/\/$/, ''));
  if (env.NEXT_PUBLIC_SITE_URL && env.NEXT_PUBLIC_SITE_URL !== env.PUBLIC_SITE_URL) {
    targets.push(env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, ''));
  }
  targets.push('http://localhost:3000');

  let okCount = 0;
  for (const base of targets) {
    try {
      const url = `${base}/api/revalidate`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths, secret }),
        signal: ctrl.signal,
      }).catch(() => null);
      clearTimeout(timer);
      if (res && res.ok) {
        okCount++;
        console.log(`   🔄 ISR 무효화: ${base} (${paths.length}개 경로)`);
      }
    } catch {
      // graceful — 다음 target 시도
    }
  }

  if (okCount === 0) {
    return { ok: 0, skipped: '모든 endpoint 응답 없음 (dev 서버 OFF + production 미배포일 수 있음)' };
  }
  return { ok: okCount, skipped: null };
}

module.exports = { revalidatePackages };
