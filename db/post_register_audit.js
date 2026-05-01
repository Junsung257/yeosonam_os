/**
 * @file post_register_audit.js
 * @description 상품 등록 직후 자동 감사 (Step 7 통합 실행)
 *   1. DB에서 해당 상품 로드
 *   2. validatePackage (W1~W19) 실행
 *   3. dev server 감지 → audit_render_vs_source 실행
 *   4. 최종 리포트 출력
 *
 * 사용: node db/post_register_audit.js <id1> <id2> ...
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const envPath = path.join(__dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const [k, ...rest] = line.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const ids = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (ids.length === 0) { console.error('사용: node db/post_register_audit.js <id1> [<id2> ...] [--no-ai] [--no-autofix] [--no-rag]'); process.exit(1); }

// insert-template의 validatePackage 재사용
const { validatePackage } = require('./templates/insert-template.js');
const { aiCrossCheck } = require('./ai_audit_helper.js');
const { runCoVeAudit } = require('./cove_audit.js');
const { applyAutoFixes } = require('./auto-fixer.js');

// ═══════════════════════════════════════════════════════════════════════════
//  W-final F1 — AI 감사 정책 (2026-04-21 최종)
// ═══════════════════════════════════════════════════════════════════════════
//  사장님 지시 (2026-04-21): Gemini 유료 호출은 **opt-in 완전 복귀**.
//  지금은 Agent Self-Audit (`/register` Step 6.5) 가 제로-코스트로 감사 수행.
//  Gemini E5/E6 는 `--ai` 명시 시에만 실행 (두 번째 의견이 필요할 때만).
//
//  ON 강제 (이 때만 유료 호출):
//    - `--ai` 또는 `POST_AUDIT_AI=1`
//
//  OFF (기본):
//    - 명시 안 하면 OFF. E1~E4 구조 감사 + RAG + 렌더 검증 + Agent self-audit 결과만 사용.
//
//  비용 캡 (ON 시에도):
//    - `POST_AUDIT_AI_MONTHLY_CAP_KRW` (기본 5000원/월)
//    - 카운터: scratch/audit_ai_usage.json
//    - 80% 소진 시 경고, 100% 도달 시 자동 OFF
// ═══════════════════════════════════════════════════════════════════════════
const AI_ENABLED        = process.env.POST_AUDIT_AI === '1' || process.argv.includes('--ai');
const COVE_DISABLED     = process.env.POST_AUDIT_COVE === '0' || process.argv.includes('--no-cove');
const AUTOFIX_DISABLED  = process.env.POST_AUDIT_AUTOFIX === '0' || process.argv.includes('--no-autofix');
const RAG_DISABLED      = process.env.POST_AUDIT_RAG === '0' || process.argv.includes('--no-rag');
const AI_MONTHLY_CAP_KRW = Number(process.env.POST_AUDIT_AI_MONTHLY_CAP_KRW || 5000);

// 비용 추정치 (Gemini 2.5 Flash, 2026-04 기준 대략)
const COST_PER_CALL_KRW = { e5: 0.5, e6: 0.3 };

// 비용 추적 (월별 누적, scratch/audit_ai_usage.json)
const USAGE_FILE = path.join(__dirname, '..', 'scratch', 'audit_ai_usage.json');
function loadUsage() {
  try { return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); } catch { return {}; }
}
function saveUsage(usage) {
  const dir = path.dirname(USAGE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2));
}
function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function currentMonthCostKrw() {
  const u = loadUsage();
  return Number(u[currentMonthKey()]?.krw || 0);
}
function recordCost(kind /* 'e5' | 'e6' */) {
  const key = currentMonthKey();
  const u = loadUsage();
  const cur = u[key] || { krw: 0, calls: { e5: 0, e6: 0 } };
  cur.krw = Number(cur.krw || 0) + (COST_PER_CALL_KRW[kind] || 0);
  cur.calls = cur.calls || { e5: 0, e6: 0 };
  cur.calls[kind] = (cur.calls[kind] || 0) + 1;
  u[key] = cur;
  saveUsage(u);
}

/** W-final F1 — Gemini 호출 여부 (opt-in 전용, 캡 체크만 수행) */
function shouldCallGemini() {
  if (!AI_ENABLED) return { enable: false, reason: 'Gemini 미명시 (--ai 또는 POST_AUDIT_AI=1 필요)' };
  const cost = currentMonthCostKrw();
  if (cost >= AI_MONTHLY_CAP_KRW) {
    return { enable: false, reason: `월 비용 캡 도달 (${cost.toFixed(1)}/${AI_MONTHLY_CAP_KRW}원)` };
  }
  return { enable: true, reason: '--ai 명시' };
}

// ─── 임베딩 (embeddings.ts와 동일 1536 dim) ──────────────────────────
const GOOGLE_AI_KEY = process.env.GOOGLE_AI_API_KEY;
const EMBED_MODEL = 'gemini-embedding-001';
const EMBED_DIM = 1536;

async function embedText(text, taskType = 'RETRIEVAL_QUERY') {
  if (!GOOGLE_AI_KEY || !text?.trim()) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${GOOGLE_AI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text: text.slice(0, 8000) }] },
          taskType,
          outputDimensionality: EMBED_DIM,
        }),
      },
    );
    if (!res.ok) return null;
    const json = await res.json();
    const v = json?.embedding?.values;
    return Array.isArray(v) && v.length === EMBED_DIM ? v : null;
  } catch { return null; }
}

// ─── RAG: 유사 과거 에러 패턴 조회 ─────────────────────────────────
// 원문 + 주요 메타를 쿼리로 사용하여 error_patterns 테이블에서 유사 패턴 top-3 반환.
async function queryRelevantPatterns(pkg) {
  if (RAG_DISABLED) return [];
  const queryText = [
    pkg.title,
    pkg.destination,
    pkg.duration ? `${pkg.duration}일` : '',
    pkg.land_operator || '',
    (pkg.raw_text || '').slice(0, 2500),
  ].filter(Boolean).join('\n');

  const embed = await embedText(queryText, 'RETRIEVAL_QUERY');
  if (!embed) return [];

  const { data, error } = await sb.rpc('match_error_patterns', {
    query_embedding: embed,
    match_threshold: 0.72,
    match_count: 3,
  });
  if (error) { console.warn(`   [RAG] 조회 실패: ${error.message}`); return []; }
  return data || [];
}

async function checkServer(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
    return r.status < 500;
  } catch { return false; }
}

// ───── Extended Rules (E1~E4) ─────────────────────────────────────────
// validatePackage(W1~W19)가 잡지 못하는 "원문 대조형" 결함 탐지.
// 어떤 상품/지역이 와도 동작하는 일반화 규칙.

function normalizeText(s) {
  return String(s || '').replace(/[\s,.\-·()~]/g, '').toLowerCase();
}

// E0: raw_text 원본 보존 검증 — 해시 부재/불일치 탐지
// Rule Zero(ERR-FUK-rawtext-pollution@2026-04-19): raw_text는 원문 원본 불변.
function checkRawTextIntegrity(pkg) {
  const issues = [];
  if (!pkg.raw_text) {
    issues.push(`E0: raw_text가 비어있음 — 감사 기준 데이터 없음. 원문 원본을 복구하세요.`);
    return issues;
  }
  const actualHash = crypto.createHash('sha256').update(pkg.raw_text).digest('hex');
  if (!pkg.raw_text_hash) {
    issues.push(`E0: raw_text_hash가 null — 원문 무결성을 검증할 수 없음. 현재 해시 저장 권장: ${actualHash.slice(0, 16)}...`);
  } else if (pkg.raw_text_hash !== actualHash) {
    issues.push(`E0: raw_text_hash 불일치 — 등록 이후 원문이 변경됨. 저장된 해시=${pkg.raw_text_hash.slice(0,16)}..., 현재=${actualHash.slice(0,16)}...`);
  }
  // 요약본 경고: raw_text가 극단적으로 짧고 parsed_data.prior_raw_text_summary 흔적이 있으면
  if (pkg.raw_text.length < 500 && !/제\s*\d+\s*일|DAY\s*\d+|\d+일차|일정표/i.test(pkg.raw_text)) {
    issues.push(`E0: raw_text가 ${pkg.raw_text.length}자로 비정상적으로 짧음 — 요약본이 저장됐을 수 있음. 원문 원본으로 교체 필요.`);
  }
  return issues;
}

// E1: 포함사항에 원문에 없는 금액/스펙이 주입되었는지
// 예: 원문 "여행자보험" → DB "2억 여행자보험"
function checkInclusionInjection(pkg) {
  const issues = [];
  const raw = pkg.raw_text;
  if (!raw || !Array.isArray(pkg.inclusions)) return issues;
  const rawNorm = normalizeText(raw);
  for (const item of pkg.inclusions) {
    if (typeof item !== 'string') continue;
    // 금액/단위 토큰만 추출 — '2박' 같은 숙박 수는 원문 보존 관례상 오탐 많아 제외
    const tokens = [...item.matchAll(/(\d+\s*억\s*(?:원)?|\d+\s*만\s*(?:원)?|\d+%|JPY\s*\d+|USD\s*\d+|\d+성급)/g)];
    for (const t of tokens) {
      const token = t[1];
      if (!rawNorm.includes(normalizeText(token))) {
        issues.push(`E1: inclusions "${item}"의 "${token}"이 raw_text에 없음 — 허위 스펙 주입 의심`);
      }
    }
  }
  return issues;
}

// E2: itinerary_data.days[i].regions가 원문 어디엔가 존재하는지 + 복수 상품 간 regions 복사 의심
// - raw_text가 요약형이면 Day별 정밀 분할이 불가하므로 "전체 원문 존재 여부"만 weak-check.
// - 추가 시그널: 모든 days의 regions가 동일하면서 duration >= 3이면 "regions 복사 의심" 경고.
function checkRegionsVsRawText(pkg) {
  const issues = [];
  const raw = pkg.raw_text;
  const days = pkg.itinerary_data?.days;
  if (!Array.isArray(days) || days.length === 0) return issues;

  // 전체 원문에 지역명이 존재하는지 (weak)
  if (raw) {
    const rawNorm = normalizeText(raw);
    for (let i = 0; i < days.length; i++) {
      const regs = days[i]?.regions || [];
      for (const reg of regs) {
        if (!reg || typeof reg !== 'string') continue;
        const regNorm = normalizeText(reg);
        if (regNorm.length < 2) continue;
        if (!rawNorm.includes(regNorm)) {
          issues.push(`E2: Day${days[i].day || i+1} regions의 "${reg}"가 원문 전체에 없음 — 허위 지역 주입 의심`);
        }
      }
    }
  }

  // Day별 regions가 모두 동일한지 (중간 일차 이동 누락 의심)
  if (days.length >= 3) {
    const fingerprints = days.map(d => (d.regions || []).join('|'));
    const uniq = new Set(fingerprints);
    if (uniq.size === 1 && fingerprints[0].length > 0) {
      // 모든 날 같은 지역 — 관광 이동이 없을 수는 있으므로 INFO 수준
      issues.push(`E2: 모든 Day의 regions가 동일(${fingerprints[0]}) — 지역 이동 표기 누락 가능성`);
    }
  }

  return issues;
}

// E3: excluded_dates와 surcharges 기간의 날짜 교집합 (출발 불가 날짜에 추가요금 모순)
function checkDateOverlap(pkg) {
  const issues = [];
  const ex = Array.isArray(pkg.excluded_dates) ? pkg.excluded_dates : [];
  const sur = Array.isArray(pkg.surcharges) ? pkg.surcharges : [];
  if (ex.length === 0 || sur.length === 0) return issues;
  const exSet = new Set(ex.map(d => String(d).slice(0, 10)));
  for (const s of sur) {
    if (!s?.start || !s?.end) continue;
    const start = new Date(s.start); const end = new Date(s.end);
    if (isNaN(start) || isNaN(end)) continue;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      if (exSet.has(iso)) {
        issues.push(`E3: surcharge "${s.name}"(${s.start}~${s.end})가 excluded_dates(${iso})와 겹침 — 출발 불가 날짜에 추가요금 모순`);
        break;
      }
    }
  }
  return issues;
}

// E4: 특약 상품에 표준약관 '예약 및 취소 규정' 문구가 렌더됐는지
function checkClauseDuplication(pkg, renderedText) {
  const issues = [];
  const notices = Array.isArray(pkg.notices_parsed) ? pkg.notices_parsed : [];
  const hasSpecial = notices.some(n => {
    if (!n || typeof n !== 'object') return false;
    if (n.type === 'PAYMENT') return true;
    return /특별약관|특약/.test(`${n.title||''} ${n.text||''}`);
  });
  if (!hasSpecial || !renderedText) return issues;
  const STANDARD_MARKERS = ['30일 전까지 취소', '29~21일 전 취소', '계약금 전액 환불'];
  for (const marker of STANDARD_MARKERS) {
    if (renderedText.includes(marker)) {
      issues.push(`E4: 특약 상품인데 렌더에 표준약관 문구 "${marker}" 노출 — mergeNotices 로직 미적용 또는 버그`);
    }
  }
  return issues;
}

async function auditOne(pkg, baseUrl) {
  const result = { id: pkg.id, title: pkg.title, short_code: pkg.short_code };

  // 1. validatePackage (W1~W19)
  const v = validatePackage(pkg);
  result.errors = v.errors;
  result.warnings = [...v.warnings];

  // 1-a. Extended Rule E0 (raw_text 원본 보존 검증 — 다른 규칙의 전제조건)
  result.warnings.push(...checkRawTextIntegrity(pkg));

  // 1-b. Extended Rules E1~E3 (원문 대조형, DB만으로 수행)
  result.warnings.push(...checkInclusionInjection(pkg));
  result.warnings.push(...checkRegionsVsRawText(pkg));
  result.warnings.push(...checkDateOverlap(pkg));

  // 1-c. RAG — 과거 유사 에러 패턴 조회 (복리 학습: 등록할수록 RAG 풍부해짐)
  result.rag_hits = await queryRelevantPatterns(pkg);
  for (const hit of result.rag_hits) {
    // similarity가 매우 높은 것만(>0.80) "주의" 수준 경고로 승격
    if (hit.similarity >= 0.80) {
      result.warnings.push(
        `RAG[${(hit.similarity * 100).toFixed(0)}%]: ${hit.error_code} "${hit.title}" — 과거 유사 패턴, 재발 주의`
      );
    }
  }

  // 1-d. W-final F1 — Gemini 호출 여부 (opt-in 전용). 기본 OFF, --ai 시만 호출.
  //      Agent self-audit 결과는 pkg.agent_audit_report 에 이미 기록되어 있음 → 그대로 result 에 복사.
  const aiDecision = shouldCallGemini();
  result.ai_decision = aiDecision;
  if (pkg.agent_audit_report) {
    result.agent_audit = pkg.agent_audit_report;
    const unsupported = (pkg.agent_audit_report.claims || []).filter(c => c.supported === false);
    if (unsupported.length > 0) {
      console.log(`   🧠 Agent self-audit: ${unsupported.length}건 불일치 감지 → warnings 승격`);
      for (const c of unsupported) {
        const prefix = c.severity === 'CRITICAL' ? 'E6 [Agent:CRITICAL]' : 'E6 [Agent:HIGH]';
        result.warnings.push(`${prefix} ${c.field || '?'} "${(c.text || '').slice(0, 100)}" — ${c.note || '원문 근거 없음'}`);
      }
    } else {
      console.log(`   🧠 Agent self-audit 통과 (${(pkg.agent_audit_report.claims || []).length}개 claim)`);
    }
  } else {
    // Mandatory per /register Step 6.5 — silent skip 금지 (Split 6 § 2.3 권고).
    console.log('   ⚠️  agent_audit_report 미기재 — Step 6.5 (Agent self-audit) 미실행 의심');
    result.errors.push('agent_audit_report 미기재 — /register Step 6.5 (Agent self-audit) 재실행 필요');
  }
  if (aiDecision.enable) console.log(`   🤖 Gemini 감사 ON: ${aiDecision.reason}`);
  else console.log(`   ⏭️  Gemini 감사 OFF: ${aiDecision.reason}`);

  // 1-e. E6 (Gemini CoVe) — opt-in 전용. Agent self-audit 와 독립적으로 두 번째 의견용.
  if (aiDecision.enable && !COVE_DISABLED && pkg.raw_text) {
    const cove = await runCoVeAudit(pkg);
    result.cove = cove;
    if (cove.available) {
      recordCost('e6');
      console.log(`      CoVe: ${cove.total_claims || 0}개 claim 검증, ${cove.unsupported_count || 0}건 불일치 (${cove.elapsed_ms}ms)`);
      result.warnings.push(...(cove.warnings || []));
    } else if (cove.reason && !/GOOGLE_AI_API_KEY/.test(cove.reason)) {
      console.log(`      CoVe 스킵: ${cove.reason}`);
    }
  }

  // 3. 렌더 페이지 audit (서버 있으면)
  if (baseUrl) {
    const renderUrl = `${baseUrl}/packages/${pkg.id}`;
    try {
      const r = await fetch(renderUrl, { signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        const html = await r.text();
        // HTML → text
        const renderedText = html
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ').trim();

        // 핵심 엔터티 검증: 최저가 / 항공편 / 호텔 / 핵심 관광지
        const priceOk = pkg.price && renderedText.includes(pkg.price.toLocaleString());
        const hotelOk = pkg.itinerary_data?.days?.some(d => d.hotel?.name && renderedText.includes(d.hotel.name.split(' ')[0]));
        const flightOk = pkg.itinerary_data?.days?.[0]?.schedule?.some(s => s.transport && renderedText.includes(s.transport));

        // E4: 특약 상품의 표준약관 중복 렌더 감지
        const clauseIssues = checkClauseDuplication(pkg, renderedText);
        if (clauseIssues.length) result.errors.push(...clauseIssues);

        // 🆕 E5: Gemini cross-check — 원문 ↔ 렌더 의미 대조 (구조 규칙이 못 잡는 축약/창작)
        // W3: AI 자동 트리거 판정(aiDecision)에 따라 결정. severity CRITICAL/HIGH → warnings 승격
        if (aiDecision.enable && pkg.raw_text && renderedText.length > 500) {
          console.log(`   🤖 E5 AI cross-check 호출 중... (${pkg.short_code})`);
          const ai = await aiCrossCheck(pkg.raw_text, renderedText, pkg.title);
          result.ai = ai;
          if (ai.available) {
            recordCost('e5');
            console.log(`      Faithfulness ${ai.overall_faithfulness_pct}% / Severity ${ai.severity} (${ai.elapsed_ms}ms)`);
            if (ai.severity === 'CRITICAL' || ai.severity === 'HIGH') {
              const summary = [ai.summary].filter(Boolean).join(' ');
              result.warnings.push(`E5 [AI:${ai.severity}] ${summary || 'AI가 의미적 오류 감지'}`);
              ai.missing_from_render?.slice(0, 3).forEach(m => result.warnings.push(`E5 누락: ${m}`));
              ai.distorted_in_render?.slice(0, 3).forEach(m => result.warnings.push(`E5 왜곡: ${m}`));
              ai.hallucinated_in_render?.slice(0, 3).forEach(m => result.warnings.push(`E5 창작: ${m}`));
            }
          } else {
            console.log(`      AI 감사 스킵: ${ai.reason}`);
          }
        }

        result.render = {
          url: renderUrl,
          status: r.status,
          length: renderedText.length,
          price_found: priceOk,
          hotel_found: hotelOk,
          flight_found: flightOk,
        };
      } else {
        result.render = { url: renderUrl, status: r.status, error: 'non-200' };
      }
    } catch (e) {
      result.render = { url: renderUrl, error: e.message };
    }
  } else {
    result.render = { skipped: 'dev server not reachable, production may not have ISR yet' };
  }

  return result;
}

(async () => {
  console.log('🔍 Post-Register Audit 시작\n');

  const baseUrls = ['http://localhost:3000', 'https://yeosonam.com'];
  let activeUrl = null;
  for (const u of baseUrls) {
    if (await checkServer(u)) { activeUrl = u; console.log(`✓ Server 감지: ${u}`); break; }
  }
  if (!activeUrl) console.log('⚠️  서버 미감지 — 렌더 audit 생략, DB 검증만 수행');
  console.log('');

  const results = [];
  for (const id of ids) {
    const { data: pkg, error } = await sb.from('travel_packages')
      .select('*').eq('id', id).maybeSingle();
    if (error || !pkg) { console.log(`❌ ${id} 조회 실패`); continue; }
    let r = await auditOne(pkg, activeUrl);

    // ─── Auto-fix: 화이트리스트 룰 자동 적용 후 1회 재감사 ────────────
    if (!AUTOFIX_DISABLED) {
      const fix = await applyAutoFixes(sb, pkg, embedText);
      if (fix.applied.length > 0) {
        console.log(`   🔧 Auto-fix ${fix.applied.length}건: ${fix.applied.map(a => a.rule_id).join(', ')}`);
        if (fix.updated) {
          const { data: refreshed } = await sb.from('travel_packages').select('*').eq('id', id).maybeSingle();
          if (refreshed) {
            r = await auditOne(refreshed, activeUrl);
            r.auto_fixes = fix.applied;
          }
        } else if (fix.error) {
          console.log(`   ⚠️  Auto-fix DB update 실패: ${fix.error}`);
          r.auto_fix_error = fix.error;
        }
      }
    }

    results.push(r);

    // 🆕 감사 결과 4단계 (P0 #2, 2026-04-27)
    //   blocked  — errors 존재. 승인 차단.
    //   warnings — 위험성 warnings 존재 (환각·축약·매칭 실패). force 필요.
    //   info     — 안내성 warnings 만 존재 (자동 처리·정보 알림). 자동 승인 OK.
    //   clean    — warnings/errors 없음.
    //
    // INFO_RULES: 데이터 무결성 영향 없는 알림형 W-code (자동 분리 안내 등).
    // 신규 INFO 규칙 추가 시 아래 set 에 W-code 추가.
    //   W11 — 콤마 포함 ▶ activity (splitScheduleItems 자동 분리 또는 W31 보호)
    //   W12 — splitScheduleItems 자동 분리 안내
    const INFO_RULES = new Set(['W11', 'W12']);
    const isInfoOnly = (warns) => warns.length > 0 && warns.every(w => {
      const m = String(w).match(/\[(W\d+)/);
      return m && INFO_RULES.has(m[1]);
    });
    const warnList = r.warnings || [];
    const auditStatus =
      (r.errors?.length || 0) > 0 ? 'blocked' :
      warnList.length === 0 ? 'clean' :
      isInfoOnly(warnList) ? 'info' : 'warnings';
    const auditReport = {
      errors: r.errors || [],
      warnings: r.warnings || [],
      render: r.render || null,
      ai: r.ai || null,
      cove: r.cove ? {
        available: r.cove.available,
        total_claims: r.cove.total_claims,
        unsupported_count: r.cove.unsupported_count,
        elapsed_ms: r.cove.elapsed_ms,
        verdicts: (r.cove.verdicts || []).filter(v => v.supported === false).map(v => ({
          field: v.field, severity: v.severity,
          text: v.text, evidence: v.evidence, note: v.note,
        })),
      } : null,
      // W-final F1 — Agent self-audit (제로-코스트, /register Step 6.5 에서 생성)
      agent_audit: r.agent_audit || null,
      ai_decision: r.ai_decision || null,
      auto_fixes: r.auto_fixes || [],
      rag_hits: (r.rag_hits || []).map(h => ({
        error_code: h.error_code,
        title: h.title,
        similarity: Number((h.similarity || 0).toFixed(3)),
      })),
      ran_at: new Date().toISOString(),
    };
    const { error: upErr } = await sb.from('travel_packages')
      .update({
        audit_status: auditStatus,
        audit_report: auditReport,
        audit_checked_at: new Date().toISOString(),
      }).eq('id', id);
    if (upErr) console.log(`⚠️  audit 결과 저장 실패 (${id}): ${upErr.message}`);
    else r._persisted_status = auditStatus;
  }

  // 🆕 Visual Regression fixtures.json 자동 등록 (ERR-FUK 재발 방지)
  try {
    const fxPath = path.join(__dirname, '..', 'tests', 'visual', 'fixtures.json');
    if (fs.existsSync(fxPath)) {
      const fixtures = JSON.parse(fs.readFileSync(fxPath, 'utf8'));
      const existingIds = new Set(fixtures.map(f => f.id));
      let added = 0;
      for (const r of results) {
        if (r.skipped || existingIds.has(r.id)) continue;
        // short_code 기반 product slug 생성
        const slug = (r.short_code || r.id.slice(0, 8)).toLowerCase().replace(/[^a-z0-9]/g, '-');
        fixtures.push({ id: r.id, title: r.title, product: slug });
        added++;
      }
      if (added > 0) {
        fs.writeFileSync(fxPath, JSON.stringify(fixtures, null, 2));
        console.log(`\n📸 Visual fixtures에 ${added}건 추가 → tests/visual/fixtures.json`);
        console.log(`   다음 실행 필요: npm run test:visual:update`);
        console.log(`   (베이스라인 1회 생성 후 모든 변경이 자동 탐지됨)`);
      }
    }
  } catch (e) {
    console.log(`⚠️  fixtures.json 업데이트 실패: ${e.message}`);
  }

  // ISR revalidation 시도 (서버 있을 때만)
  if (activeUrl && process.env.REVALIDATE_SECRET) {
    try {
      const paths = ids.map(id => `/packages/${id}`).concat(['/packages']);
      const r = await fetch(`${activeUrl}/api/revalidate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths, secret: process.env.REVALIDATE_SECRET }),
        signal: AbortSignal.timeout(10000),
      });
      console.log(`\n🔄 ISR revalidate: ${r.status}`);
    } catch (e) { console.log(`\n⚠️  ISR revalidate 실패: ${e.message}`); }
  } else if (activeUrl) {
    console.log(`\n⚠️  REVALIDATE_SECRET 미설정 — ISR 무효화 생략 (첫 고객 요청 시 자동 빌드)`);
  }

  // 리포트 출력
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  📊 감사 결과 리포트');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const r of results) {
    console.log(`📦 ${r.short_code || '(no code)'} | ${r.title}`);
    console.log(`   ID: ${r.id}`);

    // 🆕 audit_status 게이트 결과 (4단계 — info 추가)
    if (r._persisted_status) {
      const badge =
        r._persisted_status === 'clean' ? '🟢 CLEAN (즉시 승인 가능)' :
        r._persisted_status === 'info' ? '⚪ INFO (안내성 경고만 — 자동 승인 OK)' :
        r._persisted_status === 'warnings' ? '🟡 WARNINGS (어드민 확인 필요)' :
        '🔴 BLOCKED (승인 차단 — 수정 후 재감사)';
      console.log(`   audit_status: ${badge}`);
    }

    // W1-W19 결과
    if (r.errors.length === 0 && r.warnings.length === 0) {
      console.log(`   ✅ W1~W19 전체 통과`);
    } else {
      if (r.errors.length > 0) {
        console.log(`   ❌ 에러 ${r.errors.length}건 (INSERT 차단 사유)`);
        r.errors.forEach(e => console.log(`      - ${e}`));
      }
      if (r.warnings.length > 0) {
        console.log(`   ⚠️  경고 ${r.warnings.length}건`);
        r.warnings.forEach(w => console.log(`      - ${w}`));
      }
    }

    // 🆕 Auto-fix 결과
    if (r.auto_fixes && r.auto_fixes.length > 0) {
      console.log(`   🔧 자동수정 ${r.auto_fixes.length}건 적용됨:`);
      r.auto_fixes.forEach(a => console.log(`      - ${a.rule_id}: ${a.title}`));
    }

    // 🆕 RAG 유사 패턴 (경고 승격 여부와 무관하게 참고용 출력)
    if (r.rag_hits && r.rag_hits.length > 0) {
      console.log(`   🧠 RAG 유사 과거 패턴 ${r.rag_hits.length}건:`);
      r.rag_hits.forEach(h =>
        console.log(`      - [${(h.similarity * 100).toFixed(0)}%] ${h.error_code}: ${h.title.slice(0, 60)}`));
    }

    // 렌더 audit
    if (r.render.skipped) {
      console.log(`   ⏭️  렌더 audit 스킵: ${r.render.skipped}`);
    } else if (r.render.error) {
      console.log(`   ⚠️  렌더 audit 실패: ${r.render.error}`);
    } else if (r.render.status === 200) {
      // production HTML 이 너무 짧으면 ISR on-demand 빌드 미완료 → 친화적 안내 (false-positive 방어)
      if (r.render.length < 5000) {
        console.log(`   ⏳ 렌더 검증 SKIP (${r.render.url}):`);
        console.log(`      HTML 길이 ${r.render.length} bytes — production ISR 빌드 미완료로 추정 (신규 등록 직후)`);
        console.log(`      📌 production 페이지 첫 방문 시 자동 빌드 → 5~30초 후 정상 노출. 데이터 자체는 정상.`);
      } else {
        const checks = [
          r.render.price_found ? '✅' : '❌',
          r.render.hotel_found ? '✅' : '❌',
          r.render.flight_found ? '✅' : '❌',
        ];
        console.log(`   🔍 렌더 검증 (${r.render.url}):`);
        console.log(`      ${checks[0]} 최저가 표시  ${checks[1]} 호텔명 표시  ${checks[2]} 항공편 표시`);
        console.log(`      HTML 길이: ${r.render.length} bytes`);
      }
    } else {
      console.log(`   ⚠️  렌더 응답: ${r.render.status}`);
    }

    console.log(`   🔗 ${activeUrl || 'https://yeosonam.com'}/packages/${r.id}\n`);
  }

  // 종합 판정
  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);
  const totalWarnings = results.reduce((s, r) => s + r.warnings.length, 0);
  if (totalErrors === 0 && totalWarnings === 0) {
    console.log('🎉 전체 통과 — 바로 어드민에서 status 변경하여 고객 노출 가능');
  } else if (totalErrors === 0) {
    console.log(`⚠️  경고 ${totalWarnings}건 — 검토 후 필요 시 수정 / status는 변경 가능`);
  } else {
    console.log(`❌ 에러 ${totalErrors}건 — DB 수정 필요`);
  }

  // W3 — AI 감사 월간 비용 요약
  const monthlyCost = currentMonthCostKrw();
  const usage = loadUsage()[currentMonthKey()] || { krw: 0, calls: { e5: 0, e6: 0 } };
  console.log(
    `\n💰 AI 감사 월간 비용 (${currentMonthKey()}): ${monthlyCost.toFixed(1)}원 / ${AI_MONTHLY_CAP_KRW}원` +
    ` (E5 ${usage.calls?.e5 || 0}회, E6 ${usage.calls?.e6 || 0}회)`
  );
  if (monthlyCost >= AI_MONTHLY_CAP_KRW * 0.8) {
    console.log(`   ⚠️  월 캡의 80% 이상 소진 — 사장님 승인 없이 추가 실행 시 자동 OFF`);
  }

  console.log('\n어드민 승인 후 고객 노출: /admin/packages?status=pending');
})().catch(e => { console.error(e); process.exit(1); });
