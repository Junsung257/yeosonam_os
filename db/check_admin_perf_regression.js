// 어드민 속도 회귀 가드 (Phase 4-A)
//
// Phase 0~3 에서 적용한 핵심 hot path 의 응답 시간을 임계값으로 체크.
// 임계값 초과 시 exit code 1 — CI 에서 회귀 차단 가능.
//
// 사용:
//   npm run check:perf            # dev 서버 (느슨한 임계값)
//   npm run check:perf:ci         # prod-like (엄격한 임계값)
//   BASE_URL=https://… node db/check_admin_perf_regression.js
//
// 감사: docs/audits/2026-05-11-admin-perf-audit.md

// Node 18+ 의 built-in fetch 사용.
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CI_MODE = process.argv.includes('--ci');
const COOKIE = process.env.AUDIT_COOKIE || 'ys-dev-admin=1';

// 임계값(ms): dev 모드는 컴파일 비용 큰 점 고려해 느슨.
const THRESHOLDS = CI_MODE
  ? {
      '/api/admin/badge-counts':     500,
      '/api/unmatched?summary=1':    500,
      '/api/admin/analytics/ltv':    2000,
      '/api/customers?page=1&limit=30': 1500,
      '/api/bookings?limit=30&lite=1':  1500,
      '/api/packages?limit=100&lite=1&status=all&page=1&sort=created_desc': 2000,
    }
  : {
      '/api/admin/badge-counts':     3000,
      '/api/unmatched?summary=1':    8000,
      '/api/admin/analytics/ltv':    8000,
      '/api/customers?page=1&limit=30': 6000,
      '/api/bookings?limit=30&lite=1':  6000,
      '/api/packages?limit=100&lite=1&status=all&page=1&sort=created_desc': 6000,
    };

async function timeIt(url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { cookie: COOKIE } });
    // 페이로드 drain
    await res.text();
    return { ms: Date.now() - t0, status: res.status };
  } catch (e) {
    return { ms: -1, status: 0, error: e?.message ?? String(e) };
  }
}

(async () => {
  console.log(`[perf-check] mode=${CI_MODE ? 'CI' : 'dev'}  base=${BASE_URL}\n`);

  // 사전 점검 — 서버 reachable?
  const ping = await timeIt(BASE_URL + '/api/admin/badge-counts');
  if (ping.status === 0) {
    const msg = `\n[perf-check] 서버 ${BASE_URL} 에 접근 불가 (${ping.error || 'unreachable'}).`;
    if (CI_MODE) {
      console.log(msg + ' CI 모드 — 실패 처리.');
      process.exit(1);
    } else {
      console.log(msg);
      console.log('  dev 서버가 켜져 있는지 확인 (npm run dev). 측정 skip.');
      process.exit(0);
    }
  }
  if (ping.status === 401 || ping.status === 403) {
    console.log(`\n[perf-check] 인증 실패 (status=${ping.status}). dev 모드는 ys-dev-admin=1 쿠키 필요:`);
    console.log('  curl http://localhost:3000/api/debug/dev-admin-login?mode=on');
    console.log('  또는 AUDIT_COOKIE=… 환경변수로 prod 세션 쿠키 전달.');
    process.exit(CI_MODE ? 1 : 0);
  }

  const results = [];
  for (const [path, threshold] of Object.entries(THRESHOLDS)) {
    // warm-up 1회, 측정 2회 (median)
    await timeIt(BASE_URL + path);
    const a = await timeIt(BASE_URL + path);
    const b = await timeIt(BASE_URL + path);
    const ms = Math.round((a.ms + b.ms) / 2);
    const ok = a.status === 200 && b.status === 200 && ms <= threshold;
    const tag = ok ? 'PASS' : 'FAIL';
    const marker = ok ? '  ' : '⚠ ';
    console.log(`${marker}[${tag}] ${String(ms).padStart(5)}ms ≤ ${threshold}ms  ${path}`);
    results.push({ path, ms, threshold, ok, status: a.status });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n[perf-check] ${results.length - failed.length}/${results.length} passed.`);
  if (failed.length > 0) {
    console.log('\nFAILURES:');
    failed.forEach((r) => {
      console.log(`  ${r.path}: ${r.ms}ms (limit ${r.threshold}ms, status ${r.status})`);
    });
    console.log('\n어드민 속도 회귀 감지 — Phase 0~3 효과 확인 필요.');
    console.log('  - docs/audits/2026-05-11-admin-perf-audit.md');
    console.log('  - 단발 진단: db/audit_admin_perf.js');
    process.exit(1);
  }
})();
