/**
 * @file audit_render_vs_source.js
 * @description 원문(raw_text) vs 모바일 랜딩 렌더 결과(innerText) 자동 대조
 *
 * 목적: Playwright 스냅샷만으로는 "내용이 원문과 같은지" 확신 못함.
 *       이 도구가 자동으로 원문의 핵심 엔터티(호텔명/관광지/가격/일차)가
 *       렌더 결과에 실제 노출되는지 검증.
 *
 * 사용법:
 *   node db/audit_render_vs_source.js                              # fixtures.json 전체
 *   node db/audit_render_vs_source.js <package-id>                 # 단건
 *   node db/audit_render_vs_source.js --ai                         # Gemini 교차 감사 (비용 발생)
 *   BASE_URL=https://yeosonam.com node db/audit_render_vs_source.js  # 프로덕션 대상
 *
 * 출력:
 *   scratch/audits/render_vs_source_YYYY-MM-DD_<id>.md
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const [k, ...rest] = line.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const USE_AI = process.argv.includes('--ai');

const argv = process.argv.slice(2).filter(a => !a.startsWith('--'));
const TARGET_ID = argv[0];

// ─── 엔터티 추출 ─────────────────────────────────────────────────────────
// raw_text와 rendered innerText 양쪽에서 같은 방식으로 추출해 교집합/차집합 계산

function extractEntities(text) {
  const entities = {
    prices: new Set(),       // "1,399,000", "1,249,000"
    hotels: new Set(),       // "포포인츠 쉐라톤", "라마다 조호"
    landmarks: new Set(),    // "머라이언공원", "센토사섬"
    dates: new Set(),        // "6/17", "7/20"
    flights: new Set(),      // "D7 631", "AK705"
    days: new Set(),         // "1일차", "2일차"
  };

  // 가격 (숫자 콤마 천단위, 6~7자리)
  for (const m of text.matchAll(/(\d{1,3}(?:,\d{3}){1,2})(?:\s*원|\s*,-)/g)) {
    entities.prices.add(m[1]);
  }
  // ₩ 표기
  for (const m of text.matchAll(/₩([\d,]+)/g)) {
    entities.prices.add(m[1]);
  }

  // 호텔 (…호텔, …리조트, …쉐라톤, …힐튼 등)
  for (const m of text.matchAll(/([가-힣A-Za-z][가-힣A-Za-z\s·&]+(?:호텔|리조트|쉐라톤|힐튼|메리어트|윈덤|이비스|방사르|조호바루|쉐라톤))/g)) {
    const name = m[1].trim();
    if (name.length >= 3 && name.length <= 30) entities.hotels.add(name);
  }

  // 관광지 (▶로 시작하는 항목)
  for (const m of text.matchAll(/▶([가-힣A-Za-z\s()（）·&]+)/g)) {
    const name = m[1].trim().replace(/\([^)]*\)$/, '').trim();
    if (name.length >= 2 && name.length <= 25) entities.landmarks.add(name);
  }

  // 날짜 패턴 M/D
  for (const m of text.matchAll(/(\d{1,2})\/(\d{1,2})(?:\s*[(~]|\s|$)/g)) {
    const mo = parseInt(m[1]);
    const d = parseInt(m[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) entities.dates.add(`${mo}/${d}`);
  }

  // 항공편 (2문자+숫자 또는 숫자+문자+숫자)
  for (const m of text.matchAll(/\b([A-Z]{2}|\d[A-Z])(\d{2,4})\b/g)) {
    entities.flights.add(`${m[1]} ${m[2]}`.trim());
  }

  // N일차
  for (const m of text.matchAll(/(\d+)\s*일차/g)) {
    entities.days.add(`${m[1]}일차`);
  }

  return entities;
}

// 🆕 엔터티 정규화 — 공백/괄호 차이로 인한 false alarm 방지
// 예: "머라이언공원" vs "머라이언 공원" / "KLCC(외관)" vs "KLCC"
function normalizeEntity(s) {
  return String(s)
    .replace(/\s+/g, '')                // 모든 공백 제거
    .replace(/\([^)]*\)/g, '')          // 괄호 및 내용 제거
    .replace(/[·&]/g, '')                // 특수 구분자 제거
    .toLowerCase();
}

/**
 * 정규화 기반 집합 차이 계산.
 * 원본 문자열은 display용으로 유지, 비교는 normalized 버전으로.
 */
function setDiff(a, b) {
  // normalize → original 매핑
  const aMap = new Map();
  const bMap = new Map();
  for (const x of a) aMap.set(normalizeEntity(x), x);
  for (const x of b) bMap.set(normalizeEntity(x), x);

  const aOnly = [];
  const bOnly = [];
  const both = [];

  for (const [key, original] of aMap) {
    if (bMap.has(key)) both.push(original);
    else aOnly.push(original);
  }
  for (const [key, original] of bMap) {
    if (!aMap.has(key)) bOnly.push(original);
  }
  return { aOnly, bOnly, both };
}

// ─── 렌더링된 innerText 가져오기 ─────────────────────────────────────────
async function fetchRenderedText(pkgId) {
  const url = `${BASE_URL}/packages/${pkgId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const html = await res.text();
  // HTML → 텍스트 (거친 방식, cheerio 없이)
  const text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

// ─── AI 감사 (선택) ─────────────────────────────────────────────────────
async function aiAudit(rawText, renderedText, title) {
  if (!process.env.GOOGLE_AI_API_KEY) {
    return { available: false, reason: 'GOOGLE_AI_API_KEY 미설정' };
  }
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json' },
  });
  const prompt = `다음 여행 상품의 원문(landing source)과 실제 고객에게 보이는 모바일 렌더링 결과를 대조하여, 원문에는 있는데 렌더링에 누락/왜곡된 정보를 리포트해줘.

상품명: ${title}

===== 원문 (landing source) =====
${rawText.slice(0, 6000)}

===== 렌더링 결과 (모바일 innerText) =====
${renderedText.slice(0, 6000)}

다음 JSON 형식으로만 답변:
{
  "missing_from_render": ["원문에 있지만 렌더링에 없는 항목 최대 10개"],
  "distorted_in_render": ["원문과 다르게 렌더링된 항목 최대 10개"],
  "severity": "CRITICAL | HIGH | MEDIUM | LOW",
  "overall_faithfulness_pct": 0~100,
  "summary": "한 줄 요약"
}`;
  try {
    const result = await model.generateContent(prompt);
    const raw = result.response.text().replace(/^```json\s*|\s*```\s*$/g, '').trim();
    return { available: true, ...JSON.parse(raw) };
  } catch (e) {
    return { available: false, reason: e.message };
  }
}

// ─── 메인 ─────────────────────────────────────────────────────────────
async function auditOne(pkg) {
  console.log(`\n━━━ ${pkg.title} ━━━`);
  if (!pkg.raw_text) {
    console.log('  ⚠️  raw_text 없음 — 감사 스킵');
    return { pkgId: pkg.id, skipped: true };
  }

  const renderedText = await fetchRenderedText(pkg.id);
  const rawEntities = extractEntities(pkg.raw_text);
  const renderedEntities = extractEntities(renderedText);

  const sections = [];
  for (const key of Object.keys(rawEntities)) {
    const diff = setDiff(rawEntities[key], renderedEntities[key]);
    sections.push({
      key,
      raw_count: rawEntities[key].size,
      rendered_count: renderedEntities[key].size,
      missing_in_render: diff.aOnly,
      extra_in_render: diff.bOnly,
      match_count: diff.both.length,
    });
  }

  // 콘솔 요약
  for (const s of sections) {
    const status = s.missing_in_render.length === 0 ? '✅' : (s.missing_in_render.length <= 2 ? '⚠️' : '❌');
    console.log(`  ${status} ${s.key.padEnd(10)} raw=${s.raw_count.toString().padStart(3)}  rendered=${s.rendered_count.toString().padStart(3)}  match=${s.match_count.toString().padStart(3)}  missing=${s.missing_in_render.length}`);
    if (s.missing_in_render.length > 0 && s.missing_in_render.length <= 5) {
      s.missing_in_render.forEach(m => console.log(`      ─ missing: ${JSON.stringify(m)}`));
    }
  }

  let ai = null;
  if (USE_AI) {
    console.log('  🤖 AI 감사 진행...');
    ai = await aiAudit(pkg.raw_text, renderedText, pkg.title);
    if (ai.available) {
      console.log(`     Faithfulness: ${ai.overall_faithfulness_pct}% / Severity: ${ai.severity}`);
      console.log(`     → ${ai.summary}`);
    } else {
      console.log(`     AI 스킵 (${ai.reason})`);
    }
  }

  // Markdown 리포트 저장
  const dumpDir = path.join(__dirname, '..', 'scratch', 'audits');
  fs.mkdirSync(dumpDir, { recursive: true });
  const mdPath = path.join(dumpDir, `render_vs_source_${new Date().toISOString().slice(0,10)}_${pkg.id.slice(0,8)}.md`);
  const md = `# Audit Report: ${pkg.title}

- Package ID: ${pkg.id}
- Scanned: ${new Date().toISOString()}
- Base URL: ${BASE_URL}

## 엔터티 대조 요약

| 분류 | 원문 | 렌더 | 일치 | 누락 |
|------|------|------|------|------|
${sections.map(s => `| ${s.key} | ${s.raw_count} | ${s.rendered_count} | ${s.match_count} | ${s.missing_in_render.length} |`).join('\n')}

## 누락 상세

${sections.filter(s => s.missing_in_render.length > 0).map(s => `### ${s.key} (${s.missing_in_render.length}건)\n${s.missing_in_render.map(m => `- ${m}`).join('\n')}`).join('\n\n') || '_누락 없음_'}

## 렌더에만 있는 항목 (참고)

${sections.filter(s => s.extra_in_render.length > 0).map(s => `### ${s.key} (${s.extra_in_render.length}건)\n${s.extra_in_render.slice(0, 20).map(m => `- ${m}`).join('\n')}`).join('\n\n') || '_없음_'}

${ai && ai.available ? `## AI 감사 결과 (Gemini 2.5 Flash)

- **충실도**: ${ai.overall_faithfulness_pct}%
- **심각도**: ${ai.severity}
- **요약**: ${ai.summary}

### 원문에서 누락
${(ai.missing_from_render || []).map(m => `- ${m}`).join('\n') || '_없음_'}

### 왜곡된 항목
${(ai.distorted_in_render || []).map(m => `- ${m}`).join('\n') || '_없음_'}
` : ''}

## 원문 (첫 2000자)

\`\`\`
${pkg.raw_text.slice(0, 2000)}
\`\`\`
`;
  fs.writeFileSync(mdPath, md);
  console.log(`  📄 ${mdPath}`);
  return { pkgId: pkg.id, title: pkg.title, sections, ai };
}

(async () => {
  console.log(`🔍 Render vs Source Audit (base: ${BASE_URL})${USE_AI ? ' [AI 감사 ON]' : ''}\n`);

  let pkgIds;
  if (TARGET_ID) {
    pkgIds = [TARGET_ID];
  } else {
    const fxPath = path.join(__dirname, '..', 'tests', 'visual', 'fixtures.json');
    if (!fs.existsSync(fxPath)) {
      console.error('tests/visual/fixtures.json 없음 — 또는 package-id를 인자로 넘기세요.');
      process.exit(1);
    }
    const fixtures = JSON.parse(fs.readFileSync(fxPath, 'utf8'));
    pkgIds = fixtures.map(f => f.id);
  }

  const results = [];
  for (const pid of pkgIds) {
    const { data: pkg, error } = await sb.from('travel_packages').select('id, title, raw_text').eq('id', pid).maybeSingle();
    if (error || !pkg) {
      console.log(`❌ ${pid} 조회 실패`);
      continue;
    }
    const r = await auditOne(pkg);
    results.push(r);
  }

  // 종합
  console.log('\n═══════════════════════════════════════════');
  const totalMissing = results.reduce((sum, r) => sum + (r.sections?.reduce((s, sec) => s + sec.missing_in_render.length, 0) || 0), 0);
  console.log(`총 ${results.length}건 감사 — 누락 엔터티 총 ${totalMissing}건`);
  if (totalMissing > 0) console.log('→ 각 상품의 md 리포트에서 누락 상세 확인 후 DB 수정 필요');
})().catch(e => { console.error(e); process.exit(1); });
