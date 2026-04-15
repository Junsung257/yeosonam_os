/**
 * 기존 상품의 추가요금 필드를 normalized_surcharges로 일괄 변환
 *
 * 사용법:
 *   node db/migrate_surcharges.js --dry-run   (기본, UPDATE 없이 변환 결과 출력)
 *   node db/migrate_surcharges.js --apply     (실제 UPDATE 실행)
 *
 * 전제:
 *   1. supabase/migrations/20260417000000_add_normalized_surcharges.sql 이 먼저 실행돼야 함
 *   2. .env.local 에 SUPABASE_SERVICE_ROLE_KEY 존재
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DRY_RUN = !APPLY;

// ── Supabase ──
function initSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf-8');
  const env = {};
  envFile.split('\n').forEach((l) => {
    const [k, ...v] = l.split('=');
    if (k) env[k.trim()] = v.join('=').trim();
  });
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

// ── 문자열 → Surcharge 변환 (pricing.ts 로직 JS 포팅) ──
function parseAmount(raw) {
  if (!raw) return { amount_krw: null, amount_usd: null, unit: null };
  const usdMatch = raw.match(/\$\s*(\d+(?:\.\d+)?)/);
  const usd = usdMatch ? Math.round(parseFloat(usdMatch[1])) : null;

  let krw = null;
  const manMatch = raw.match(/(\d+(?:\.\d+)?)\s*만원/);
  const wonMatch = raw.match(/(\d[\d,]*)\s*원/);
  if (manMatch) krw = Math.round(parseFloat(manMatch[1]) * 10000);
  else if (wonMatch) {
    const n = parseInt(wonMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(n)) krw = n;
  }

  let unit = null;
  if (/\/\s*인\s*\/\s*박/.test(raw)) unit = '인/박';
  else if (/룸당/.test(raw)) unit = '룸당';
  else if (/\/\s*인/.test(raw) || /인당/.test(raw)) unit = '인';
  else if (/\/\s*박/.test(raw) || /박당/.test(raw)) unit = '박';

  return { amount_krw: krw, amount_usd: usd, unit };
}

function toSurcharge(raw, kind) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '포함' || trimmed === '-' || trimmed === 'null') return null;
  const { amount_krw, amount_usd, unit } = parseAmount(trimmed);
  return { amount_krw, amount_usd, period: null, note: trimmed, kind, unit };
}

function inferKind(note) {
  if (!note) return 'other';
  if (/축제|나담|공휴일|성수기/.test(note)) return 'festival';
  if (/싱글/.test(note)) return 'single';
  if (/호텔|리조트|라사피네트|호라이즌/.test(note)) return 'hotel';
  if (/디너|식사|의무/.test(note)) return 'meal';
  if (/가이드|기사|tip|팁/i.test(note)) return 'guide';
  if (/소규모|인원/.test(note)) return 'small_group';
  return 'other';
}

function normalizeOne(pkg) {
  const result = [];
  const seen = new Set();
  const push = (s) => {
    if (!s) return;
    const key = `${s.kind}:${s.note}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(s);
  };

  if (pkg.guide_tip) push(toSurcharge(pkg.guide_tip, 'guide'));
  if (pkg.single_supplement) push(toSurcharge(pkg.single_supplement, 'single'));
  if (pkg.small_group_surcharge) push(toSurcharge(pkg.small_group_surcharge, 'small_group'));

  if (Array.isArray(pkg.surcharges)) {
    for (const s of pkg.surcharges) {
      if (!s || !s.note) continue;
      const note = String(s.note);
      push({
        amount_krw: typeof s.amount_krw === 'number' ? s.amount_krw : null,
        amount_usd: typeof s.amount_usd === 'number' ? s.amount_usd : null,
        period: s.period ?? null,
        note,
        kind: inferKind(note),
        unit: null,
      });
    }
  }

  return result;
}

// ── 메인 ──
async function main() {
  const sb = initSupabase();
  console.log(`[Migrate] 모드: ${DRY_RUN ? 'DRY RUN (UPDATE 없음)' : 'APPLY (실제 반영)'}`);

  const { data, error } = await sb
    .from('travel_packages')
    .select('id, title, guide_tip, single_supplement, small_group_surcharge, surcharges, normalized_surcharges')
    .limit(10000);

  if (error) {
    console.error('[Migrate] 조회 실패:', error);
    process.exit(1);
  }

  let total = 0;
  let changed = 0;
  let empty = 0;

  for (const pkg of data ?? []) {
    total++;
    const normalized = normalizeOne(pkg);
    if (normalized.length === 0) {
      empty++;
      continue;
    }
    // 이미 동일하면 skip
    const prev = JSON.stringify(pkg.normalized_surcharges ?? []);
    const next = JSON.stringify(normalized);
    if (prev === next) continue;

    changed++;
    if (DRY_RUN) {
      console.log(`\n[DRY] ${pkg.id} / ${pkg.title}`);
      console.log('  guide_tip:', pkg.guide_tip ?? '-');
      console.log('  single:', pkg.single_supplement ?? '-');
      console.log('  small_group:', pkg.small_group_surcharge ?? '-');
      console.log('  surcharges:', JSON.stringify(pkg.surcharges ?? []));
      console.log('  → normalized:', JSON.stringify(normalized));
    } else {
      const { error: upErr } = await sb
        .from('travel_packages')
        .update({ normalized_surcharges: normalized })
        .eq('id', pkg.id);
      if (upErr) {
        console.error(`[Migrate] UPDATE 실패 ${pkg.id}:`, upErr.message);
      }
    }
  }

  console.log(`\n[Migrate] 총 ${total}건 중 변경 ${changed}건, 빈배열 ${empty}건`);
  console.log(DRY_RUN ? '[Migrate] --apply 플래그로 실제 UPDATE 실행' : '[Migrate] UPDATE 완료');
}

main().catch((e) => {
  console.error('[Migrate] 예외:', e);
  process.exit(1);
});
