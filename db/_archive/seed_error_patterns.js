/**
 * @file seed_error_patterns.js
 * @description error-registry.md(사람이 작성한 46건 이력)를 파싱 → Gemini 임베딩 생성
 *              → error_patterns 테이블에 upsert.
 *
 * 사용: node db/seed_error_patterns.js
 * 멱등: upsert_error_pattern RPC가 (error_code, category) 중복 시 occurrence_count만 증가.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// ─── env 로드 ───────────────────────────────────────────────────────
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [k, ...rest] = line.split('=');
    if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_AI_KEY = process.env.GOOGLE_AI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('❌ Supabase 환경변수 없음'); process.exit(1); }
if (!GOOGLE_AI_KEY) { console.error('❌ GOOGLE_AI_API_KEY 없음 — 임베딩 생성 불가'); process.exit(1); }

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── 임베딩 (embeddings.ts와 동일 로직 — 1536 dim) ──────────────────
const EMBED_MODEL = 'gemini-embedding-001';
const EMBED_DIM = 1536;

async function embedText(text, taskType = 'RETRIEVAL_DOCUMENT') {
  if (!text?.trim()) return null;
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
    if (!res.ok) { console.warn(`   [embed] HTTP ${res.status}`); return null; }
    const json = await res.json();
    const v = json?.embedding?.values;
    return Array.isArray(v) && v.length === EMBED_DIM ? v : null;
  } catch (e) {
    console.warn(`   [embed] 실패:`, e.message);
    return null;
  }
}

// ─── MD → 카테고리 매핑 ─────────────────────────────────────────────
const CATEGORY_MAP = {
  'AI 파싱': 'parse',
  '렌더링': 'render',
  '데이터스키마': 'data',
  '데이터 스키마': 'data',
  '매칭': 'match',
  '검증': 'validate',
  '중복감지': 'dedupe',
  '프로세스': 'process',
};

function inferCategoryFromCode(code) {
  // 코드명 접미사로 fallback
  if (/ISR|leaks|customer/i.test(code)) return 'render';
  if (/AUDIT|audit/i.test(code)) return 'validate';
  if (/process/i.test(code)) return 'process';
  return 'data';
}

function parseEntry(block) {
  const lines = block.split('\n');
  const header = lines[0]; // "### ERR-xxx: title"
  // 간단 파싱: "### " 제거 후 첫 ":" 기준 분할 (정규식 edge case 회피)
  const clean = header.replace(/^###\s+/, '');
  const colonIdx = clean.indexOf(':');
  if (colonIdx === -1) return null;

  const errorCode = clean.slice(0, colonIdx).trim();
  const title = clean.slice(colonIdx + 1).replace(/^[🚨⚠️]+\s*/, '').trim();
  if (!errorCode || !title) return null;

  const body = lines.slice(1).join('\n').trim();

  // 카테고리 추출 (CRLF/LF 모두 대응, relaxed ** matching)
  let category = null;
  const catMatch = body.match(/카테고리\*{0,2}\s*:\s*([^\r\n|]+)/);
  if (catMatch) {
    const raw = catMatch[1].trim();
    category = CATEGORY_MAP[raw] || null;
    if (!category) {
      // "데이터스키마 + 렌더링" 같은 복합 → 첫 카테고리 사용
      const first = raw.split(/\s*\+\s*/)[0].trim();
      category = CATEGORY_MAP[first] || null;
    }
  }
  if (!category) category = inferCategoryFromCode(errorCode);

  // severity: 🚨 또는 CRITICAL 키워드
  const severity = /🚨|CRITICAL/.test(`${header} ${body}`) ? 'error' : 'warning';

  // 키워드: 제목의 한글/영문 2자 이상 토큰 (상위 6개)
  const stopwords = new Set(['한글', '파싱', '렌더', '오류', '에러', '재발', '누락']);
  const keywords = [...new Set(
    (title.match(/[가-힣A-Za-z_]{2,}/g) || []).filter(k => !stopwords.has(k))
  )].slice(0, 6);

  return {
    error_code: errorCode,
    category,
    title,
    description: body.length > 6000 ? body.slice(0, 6000) + '...(truncated)' : body,
    trigger_keywords: keywords,
    severity,
  };
}

// ─── 메인 ───────────────────────────────────────────────────────────
(async () => {
  const mdPath = path.join(__dirname, 'error-registry.md');
  const content = fs.readFileSync(mdPath, 'utf8');

  // "### ERR-" 앞에서 split — 모든 실제 엔트리 (포맷 템플릿 ## ERR-YYYYMMDD-NN 은 제외됨)
  const blocks = content.split(/\n(?=### ERR-)/).filter(b => b.startsWith('### ERR-'));
  console.log(`📋 ${blocks.length}건 에러 엔트리 감지\n`);

  const entries = blocks.map(parseEntry).filter(Boolean);
  console.log(`   파싱 성공: ${entries.length}건\n`);

  let ok = 0, fail = 0;
  const failed = [];

  for (const e of entries) {
    // 임베딩은 제목 + 설명 앞부분 (토큰 절약)
    const embedSource = `[${e.category}] ${e.title}\n\n${e.description.slice(0, 3500)}`;
    const embed = await embedText(embedSource);

    if (!embed) {
      fail++;
      failed.push(e.error_code);
      console.log(`   ❌ ${e.error_code} — embed 실패`);
      continue;
    }

    const { error } = await sb.rpc('upsert_error_pattern', {
      p_error_code: e.error_code,
      p_category: e.category,
      p_title: e.title,
      p_description: e.description,
      p_trigger_keywords: e.trigger_keywords,
      p_bad_example: null,
      p_good_fix: null,
      p_embedding: embed,
      p_source: 'registry-md',
      p_severity: e.severity,
      p_related_package_id: null,
    });

    if (error) {
      fail++;
      failed.push(e.error_code);
      console.log(`   ❌ ${e.error_code} — RPC: ${error.message}`);
    } else {
      ok++;
      console.log(`   ✅ ${e.error_code.padEnd(28)} [${e.category.padEnd(8)}] ${e.title.slice(0, 48)}`);
    }

    // Rate limit 방어 (Gemini embed는 분당 1500 request 한도지만 보수적으로 200ms)
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Seed 완료: ${ok}건 import / ❌ 실패: ${fail}건`);
  if (failed.length > 0) console.log(`   실패 목록: ${failed.join(', ')}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
})().catch(e => { console.error(e); process.exit(1); });
