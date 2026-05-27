/**
 * @file auto-fixer.js
 * @description 감사 결과 기반 자가 수정 엔진.
 *   post_register_audit.js 가 감지한 결함을 **화이트리스트 룰**로만 자동 수정.
 *   각 룰은:
 *     - matches(pkg) → 감지 여부
 *     - apply(pkg)   → { patch, evidence }
 *
 * 설계 원칙:
 *   1. 사실 왜곡 위험이 있는 수정은 **절대 자동화하지 않음**
 *      (가격/호텔명/항공사/출발일 등은 원문에서만 올 수 있음)
 *   2. 수정은 화이트리스트 룰만 — 신규 패턴 탐지 시에는 기록만 남기고 사람이 승격
 *   3. 모든 수정은 error_patterns 테이블에 upsert → 재발 감시 + 복리 학습
 *   4. 멱등 — 같은 pkg에 반복 실행해도 결과 동일
 *
 * 참고 논문:
 *   - Voyager (NVIDIA 2023): skill library
 *   - Self-Refine (Madaan 2023): LLM이 자기 출력 비판 후 수정
 */

const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────
// 공통 헬퍼
// ─────────────────────────────────────────────────────────────
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function uniqBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// 선택관광 이름에서 region 키워드 추론 — src/lib/itinerary-render.ts의 REGION_ALIAS 축약판.
// 화이트리스트 자동수정 대상이므로 **자주 등장하는 지역만** 정의.
const REGION_ALIAS = {
  '말레이시아': ['쿠알라룸푸르', '쿠알라', '말라카', '겐팅'],
  '싱가포르': ['싱가포르', 'Singapore', 'SG'],
  '태국': ['방콕', '파타야', '푸켓', '치앙마이'],
  '베트남': ['하노이', '호치민', '다낭', '나트랑', '푸꾸옥'],
  '일본': ['후쿠오카', '오사카', '도쿄', '삿포로', '오키나와'],
  '중국': ['북경', '상해', '서안', '청도', '장가계', '연길'],
  '대만': ['타이페이', '타이베이', '가오슝'],
  '필리핀': ['세부', '보홀', '보라카이', '마닐라'],
};

function inferTourRegion(name) {
  if (!name) return null;
  // 괄호 안 키워드 우선 ("2층버스 (싱가포르)")
  const parenMatch = name.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const inside = parenMatch[1];
    for (const [region, kws] of Object.entries(REGION_ALIAS)) {
      if (kws.some(kw => inside.includes(kw)) || inside.includes(region)) return region;
    }
  }
  // 본문에서 찾기
  for (const [region, kws] of Object.entries(REGION_ALIAS)) {
    if (kws.some(kw => name.includes(kw))) return region;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// 화이트리스트 룰 (6종)
// ─────────────────────────────────────────────────────────────
const RULES = [
  // ───────────────────────────────────────────────────────────
  // R1: 과거 출발일 자동 제거
  // 연관 원칙: E0 (출발일 무결성), ERR-20260419 파생
  // ───────────────────────────────────────────────────────────
  {
    id: 'AF-past-dates',
    category: 'data',
    title: '과거 출발일 자동 제거',
    description: 'price_dates에 오늘 이전 날짜가 섞여 있으면 제거. 과거 상품이 고객에 노출되는 것 방지.',
    matches(pkg) {
      const today = todayIso();
      return Array.isArray(pkg.price_dates) &&
        pkg.price_dates.some(d => typeof d?.date === 'string' && d.date < today);
    },
    apply(pkg) {
      const today = todayIso();
      const original = pkg.price_dates;
      const kept = original.filter(d => typeof d?.date === 'string' && d.date >= today);
      const removed = original.filter(d => typeof d?.date === 'string' && d.date < today);
      return {
        patch: { price_dates: kept },
        evidence: {
          field: 'price_dates',
          removed_count: removed.length,
          removed_dates: removed.slice(0, 5).map(d => d.date),
          kept_count: kept.length,
        },
      };
    },
  },

  // ───────────────────────────────────────────────────────────
  // R2: 중복 price_dates 제거 (같은 날짜 중복)
  // 연관: ERR-20260417-04 (중복 감지)
  // ───────────────────────────────────────────────────────────
  {
    id: 'AF-dedupe-price-dates',
    category: 'data',
    title: '중복 price_dates 제거',
    description: '같은 date가 여러 번 있으면 첫 항목만 유지. confirmed=true를 우선.',
    matches(pkg) {
      if (!Array.isArray(pkg.price_dates)) return false;
      const dates = pkg.price_dates.map(d => d?.date).filter(Boolean);
      return new Set(dates).size !== dates.length;
    },
    apply(pkg) {
      const original = pkg.price_dates;
      // confirmed=true 우선하도록 정렬 후 dedupe
      const sorted = [...original].sort((a, b) => (b?.confirmed ? 1 : 0) - (a?.confirmed ? 1 : 0));
      const deduped = uniqBy(sorted, d => d?.date).sort((a, b) =>
        String(a?.date || '').localeCompare(String(b?.date || ''))
      );
      return {
        patch: { price_dates: deduped },
        evidence: {
          field: 'price_dates',
          before_count: original.length,
          after_count: deduped.length,
          removed_duplicates: original.length - deduped.length,
        },
      };
    },
  },

  // ───────────────────────────────────────────────────────────
  // R3: optional_tours region 누락 자동 추론
  // 연관: ERR-KUL-04 (optional_tours 지역 라벨 불일치)
  // ───────────────────────────────────────────────────────────
  {
    id: 'AF-optional-tour-region',
    category: 'data',
    title: '선택관광 region 자동 추론',
    description: 'optional_tours[i].region이 비어있고 name에 지역 키워드가 있으면 region 세팅.',
    matches(pkg) {
      if (!Array.isArray(pkg.optional_tours)) return false;
      return pkg.optional_tours.some(t => !t?.region && inferTourRegion(t?.name));
    },
    apply(pkg) {
      const original = pkg.optional_tours;
      const fixed = [];
      const inferred = [];
      for (const t of original) {
        if (!t?.region) {
          const r = inferTourRegion(t?.name);
          if (r) {
            fixed.push({ ...t, region: r });
            inferred.push({ name: t.name, region: r });
            continue;
          }
        }
        fixed.push(t);
      }
      return {
        patch: { optional_tours: fixed },
        evidence: {
          field: 'optional_tours',
          inferred_count: inferred.length,
          samples: inferred.slice(0, 3),
        },
      };
    },
  },

  // ───────────────────────────────────────────────────────────
  // R4: excluded_dates ↔ price_dates 충돌 제거
  // 연관: E3 (excluded_dates와 surcharges 날짜 교집합)
  // ───────────────────────────────────────────────────────────
  {
    id: 'AF-excluded-price-conflict',
    category: 'data',
    title: 'excluded_dates와 겹치는 price_dates 제거',
    description: '출발 불가 날짜(excluded_dates)가 price_dates에도 있으면 price_dates에서 제거.',
    matches(pkg) {
      if (!Array.isArray(pkg.excluded_dates) || !Array.isArray(pkg.price_dates)) return false;
      const excluded = new Set(pkg.excluded_dates.map(d => String(d).slice(0, 10)));
      return pkg.price_dates.some(d => excluded.has(String(d?.date || '').slice(0, 10)));
    },
    apply(pkg) {
      const excluded = new Set(pkg.excluded_dates.map(d => String(d).slice(0, 10)));
      const kept = pkg.price_dates.filter(d => !excluded.has(String(d?.date || '').slice(0, 10)));
      const removed = pkg.price_dates.length - kept.length;
      return {
        patch: { price_dates: kept },
        evidence: {
          field: 'price_dates',
          removed_due_to_exclusion: removed,
          excluded_dates: [...excluded].slice(0, 5),
        },
      };
    },
  },

  // ───────────────────────────────────────────────────────────
  // R5: title 끝 공백/이중공백 정리
  // 연관: 사소하지만 자주 발견. UI 정렬 깨짐 방지.
  // ───────────────────────────────────────────────────────────
  {
    id: 'AF-title-whitespace',
    category: 'data',
    title: 'title 공백 정리',
    description: 'title의 앞뒤 공백 + 연속 공백을 단일 공백으로.',
    matches(pkg) {
      return typeof pkg.title === 'string' && pkg.title !== pkg.title.trim().replace(/\s+/g, ' ');
    },
    apply(pkg) {
      const before = pkg.title;
      const after = pkg.title.trim().replace(/\s+/g, ' ');
      return {
        patch: { title: after },
        evidence: { field: 'title', before, after },
      };
    },
  },

  // ───────────────────────────────────────────────────────────
  // R6: raw_text_hash 누락 보완
  // 연관: E0 (raw_text 원본 보존 검증)
  // ───────────────────────────────────────────────────────────
  {
    id: 'AF-raw-text-hash',
    category: 'data',
    title: 'raw_text_hash 자동 계산',
    description: 'raw_text가 있는데 raw_text_hash가 null이면 SHA256 계산하여 저장.',
    matches(pkg) {
      return typeof pkg.raw_text === 'string' && pkg.raw_text.length > 0 && !pkg.raw_text_hash;
    },
    apply(pkg) {
      const hash = crypto.createHash('sha256').update(pkg.raw_text).digest('hex');
      return {
        patch: { raw_text_hash: hash },
        evidence: { field: 'raw_text_hash', hash_preview: hash.slice(0, 16) },
      };
    },
  },
];

// ─────────────────────────────────────────────────────────────
// 엔진
// ─────────────────────────────────────────────────────────────

/**
 * 주어진 패키지에 대해 화이트리스트 룰을 순차 적용.
 * 반환: { applied: [{rule_id, evidence}], patch: {field: value}, hadChanges }
 */
function computeAutoFixes(pkg) {
  const applied = [];
  const patch = {};
  let working = { ...pkg };

  for (const rule of RULES) {
    if (!rule.matches(working)) continue;
    const { patch: rulePatch, evidence } = rule.apply(working);
    Object.assign(patch, rulePatch);
    working = { ...working, ...rulePatch };
    applied.push({
      rule_id: rule.id,
      category: rule.category,
      title: rule.title,
      evidence,
    });
  }

  return { applied, patch, hadChanges: applied.length > 0 };
}

/**
 * supabase에 수정 반영 + error_patterns에 이력 기록.
 * sb: supabase 서비스롤 클라이언트
 * pkg: 현재 DB 상태의 package row
 * embedFn: async (text) => number[] | null  (재사용 가능한 임베딩 함수)
 */
async function applyAutoFixes(sb, pkg, embedFn) {
  const { applied, patch, hadChanges } = computeAutoFixes(pkg);
  if (!hadChanges) return { applied: [], updated: false };

  // 1. DB 업데이트
  const { error: updErr } = await sb.from('travel_packages')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', pkg.id);
  if (updErr) {
    return { applied, updated: false, error: updErr.message };
  }

  // 2. error_patterns 테이블에 기록 (복리 학습용)
  for (const a of applied) {
    try {
      const embedSource = `[auto-fix:${a.rule_id}] ${a.title}\n${JSON.stringify(a.evidence).slice(0, 1500)}`;
      const embed = embedFn ? await embedFn(embedSource) : null;
      await sb.rpc('upsert_error_pattern', {
        p_error_code: a.rule_id,
        p_category: a.category,
        p_title: a.title,
        p_description: `Auto-fixer가 ${a.title} 적용. evidence=${JSON.stringify(a.evidence).slice(0, 800)}`,
        p_trigger_keywords: [a.rule_id, a.category],
        p_bad_example: null,
        p_good_fix: { patch_keys: Object.keys(patch), evidence: a.evidence },
        p_embedding: embed,
        p_source: 'auto-fixer',
        p_severity: 'info',
        p_related_package_id: pkg.id,
      });
    } catch (e) {
      // 기록 실패는 수정 성공을 막지 않음 (best-effort)
      console.warn(`[auto-fixer] upsert_error_pattern 실패 (${a.rule_id}):`, e.message || e);
    }
  }

  return { applied, updated: true, patch };
}

module.exports = { computeAutoFixes, applyAutoFixes, RULES };
