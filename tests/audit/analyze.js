#!/usr/bin/env node
/**
 * 감사 결과(results.ndjson) 분석 → P0/P1/P2 분류 + 마크다운 리포트
 */
const fs = require('fs');
const path = require('path');

const NDJSON = path.join(__dirname, 'results.ndjson');
const OUT_MD = path.join(__dirname, 'audit-report.md');
const OUT_JSON = path.join(__dirname, 'audit-summary.json');

const lines = fs.readFileSync(NDJSON, 'utf-8').split('\n').filter(Boolean);
const results = lines.map((l) => {
  try {
    return JSON.parse(l);
  } catch (e) {
    return null;
  }
}).filter(Boolean);

console.log(`Loaded ${results.length} audit results.`);

// === 분류 함수 ===
const FRIENDLY_AUTH_HINTS = ['Unexpected token', '<!DOCTYPE'];

function classify(r) {
  const tags = [];

  // HTTP status
  if (r.status === 0) tags.push('NAV_FAIL');
  else if (r.status >= 500) tags.push(`HTTP_${r.status}`);
  else if (r.status === 404) tags.push('HTTP_404');
  else if (r.status >= 400) tags.push(`HTTP_${r.status}`);

  // Page errors (uncaught JS exceptions on the page)
  const realPageErrors = (r.pageErrors || []).filter((e) => {
    return !FRIENDLY_AUTH_HINTS.some((h) => e.includes(h));
  });
  if (realPageErrors.length > 0) tags.push('PAGE_ERROR');

  // Console errors (excluding auth-related JSON parse)
  const realConsoleErrors = (r.consoleErrors || []).filter((e) => {
    if (FRIENDLY_AUTH_HINTS.some((h) => e.includes(h))) return false;
    if (e.includes('Failed to load resource')) return false; // already counted in failedRequests
    return true;
  });
  if (realConsoleErrors.length > 0) tags.push('CONSOLE_ERROR');

  // 5xx API failures
  const failed5xx = (r.failedRequests || []).filter((f) => f.status >= 500);
  if (failed5xx.length > 0) tags.push('API_5XX');

  // 4xx API failures (excluding 401/403 which are auth-related)
  const failed4xx = (r.failedRequests || []).filter((f) => f.status >= 400 && f.status < 500 && f.status !== 401 && f.status !== 403);
  if (failed4xx.length > 0) tags.push('API_4XX');

  // Visible error text on page
  if (r.hasErrorText) tags.push('ERROR_TEXT');

  // Performance
  if (r.loadMs > 15000) tags.push('PERF_VERY_SLOW');
  else if (r.loadMs > 8000) tags.push('PERF_SLOW');

  // Broken anchor links (href="#" or empty)
  if (r.brokenLinks > 0) tags.push(`BROKEN_LINKS_${r.brokenLinks}`);

  // Buttons with no apparent handler — heuristic, often false positive in React
  // We won't tag this as P0 — just informational

  return { tags, realPageErrors, realConsoleErrors, failed5xx, failed4xx };
}

const enriched = results.map((r) => ({ ...r, ...classify(r) }));

// === Severity buckets ===
const P0 = []; // user-blocking: page crashes, navigation fail, 5xx
const P1 = []; // user-affecting: API errors, broken links, slow perf, page errors
const P2 = []; // polish: minor warnings, slow-but-not-broken

for (const r of enriched) {
  const t = r.tags;
  if (t.includes('NAV_FAIL') || t.some((x) => x.startsWith('HTTP_5')) || t.includes('HTTP_404') || t.includes('PAGE_ERROR') || t.includes('API_5XX') || t.includes('ERROR_TEXT')) {
    P0.push(r);
  } else if (t.includes('CONSOLE_ERROR') || t.includes('API_4XX') || t.some((x) => x.startsWith('BROKEN_LINKS_')) || t.includes('PERF_VERY_SLOW')) {
    P1.push(r);
  } else if (t.length > 0) {
    P2.push(r);
  }
}

// === Stats ===
const total = enriched.length;
const okPages = enriched.filter((r) => r.tags.length === 0).length;
const avgLoad = Math.round(enriched.reduce((s, r) => s + r.loadMs, 0) / total);
const slowPages = enriched.filter((r) => r.loadMs > 8000).sort((a, b) => b.loadMs - a.loadMs).slice(0, 20);

const summary = {
  total,
  okPages,
  P0: P0.length,
  P1: P1.length,
  P2: P2.length,
  avgLoadMs: avgLoad,
};
fs.writeFileSync(OUT_JSON, JSON.stringify({ summary, P0, P1, P2, slowPages }, null, 2));

// === Markdown Report ===
function fmt(r) {
  const errs = [];
  if (r.realPageErrors?.length) errs.push(`pageError: ${r.realPageErrors[0].slice(0, 100)}`);
  if (r.realConsoleErrors?.length) errs.push(`console: ${r.realConsoleErrors[0].slice(0, 100)}`);
  if (r.failed5xx?.length) errs.push(`5xx: ${r.failed5xx.map((f) => `${f.status} ${f.url.split('/').slice(-3).join('/')}`).slice(0, 2).join(' | ')}`);
  if (r.failed4xx?.length) errs.push(`4xx: ${r.failed4xx.map((f) => `${f.status} ${f.url.split('/').slice(-3).join('/')}`).slice(0, 2).join(' | ')}`);
  if (r.hasErrorText) errs.push(`errorText: "${r.bodyTextSnippet?.slice(0, 80)}..."`);
  return `- \`${r.route}\` [${r.tags.join(',')}] ${r.loadMs}ms — ${errs.join(' | ') || 'no detail'}`;
}

let md = `# 페이지 전수 감사 리포트 (Playwright Runtime Audit)\n\n`;
md += `**날짜:** ${new Date().toISOString().slice(0, 10)}\n`;
md += `**대상:** ${total} pages (static + dynamic w/ sample IDs)\n`;
md += `**Dev 서버:** http://127.0.0.1:3000 (NODE_ENV=development)\n\n`;
md += `## 요약\n\n`;
md += `| Metric | Count |\n|---|---|\n`;
md += `| 전체 페이지 | ${total} |\n`;
md += `| ✅ 이슈 없음 | ${okPages} |\n`;
md += `| 🔴 P0 (블로커) | ${P0.length} |\n`;
md += `| 🟠 P1 (사용성) | ${P1.length} |\n`;
md += `| 🟡 P2 (마이너) | ${P2.length} |\n`;
md += `| 평균 로드(dev) | ${avgLoad}ms |\n\n`;

md += `## P0 — 블로커 (${P0.length}건)\n`;
md += `> 페이지가 깨짐, 네비게이션 실패, 5xx, 페이지에 에러 문구 노출\n\n`;
if (P0.length === 0) md += `_없음_\n\n`;
else md += P0.map(fmt).join('\n') + '\n\n';

md += `## P1 — 사용성 영향 (${P1.length}건)\n`;
md += `> 콘솔 에러, 4xx API 실패, 깨진 링크, 매우 느린 로드 (>15s)\n\n`;
if (P1.length === 0) md += `_없음_\n\n`;
else md += P1.map(fmt).join('\n') + '\n\n';

md += `## P2 — 마이너 (${P2.length}건)\n`;
md += `> 약간 느린 로드 (8~15s), 기타 경고\n\n`;
if (P2.length === 0) md += `_없음_\n\n`;
else md += P2.map(fmt).join('\n') + '\n\n';

md += `## Top 20 느린 페이지\n\n`;
md += `| 페이지 | 로드(ms) | 상태 |\n|---|---|---|\n`;
md += slowPages.map((r) => `| \`${r.route}\` | ${r.loadMs} | ${r.status} |`).join('\n') + '\n\n';

md += `## 참고\n`;
md += `- **dev 모드 컴파일 오버헤드** 때문에 첫 방문이 느림. 프로덕션 빌드에서는 일반적으로 5~10x 빠름.\n`;
md += `- HTTP 200 + ERROR_TEXT 는 페이지가 응답하나 컨텐츠에 "오류" 표시 — 보통 데이터 적재 실패.\n`;
md += `- "PAGE_ERROR" 는 페이지 라이프사이클에서 throw된 uncaught error — 가장 시급.\n`;

fs.writeFileSync(OUT_MD, md);
console.log(`\nReport written: ${OUT_MD}`);
console.log(`Summary: P0=${P0.length} P1=${P1.length} P2=${P2.length} OK=${okPages}/${total}`);
