/**
 * special_notes → customer_notes / internal_notes 이관
 *
 * FIELD_POLICY.md (2026-04-27): special_notes DEPRECATED
 * - 고객 노출 가능한 내용 → customer_notes
 * - 운영/정산 메모 → internal_notes
 *
 * 실행: node db/migrate_special_notes.js [--dry-run]
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data: packages, error } = await supabase
    .from('travel_packages')
    .select('id, short_code, title, special_notes, customer_notes, internal_notes')
    .not('special_notes', 'is', null)
    .neq('special_notes', '');

  if (error) { console.error('조회 실패:', error.message); process.exit(1); }
  if (!packages?.length) { console.log('✅ special_notes가 있는 상품 없음'); return; }

  console.log(`📦 special_notes 있는 상품: ${packages.length}건`);

  // 내용별 분류 규칙 (운영 키워드가 있으면 internal_notes, 아니면 customer_notes)
  const INTERNAL_KEYWORDS = /커미션|수수료|정산|마진|랜드사|원가|코스트|cost|commission/i;

  let moved = 0;
  for (const pkg of packages) {
    const note = pkg.special_notes?.trim();
    if (!note) continue;

    const isInternal = INTERNAL_KEYWORDS.test(note);
    const targetField = isInternal ? 'internal_notes' : 'customer_notes';

    // 기존 값이 있으면 이어붙이기 (덮어쓰기 방지)
    const existing = pkg[targetField]?.trim() || '';
    const merged = existing ? `${existing}\n\n[특기사항 이관] ${note}` : note;

    if (DRY_RUN) {
      console.log(`[DRY] ${pkg.short_code || pkg.id}: special_notes → ${targetField}`);
      console.log(`  내용: "${note.slice(0, 80)}${note.length > 80 ? '...' : ''}"`);
      continue;
    }

    const { error: updateErr } = await supabase
      .from('travel_packages')
      .update({ [targetField]: merged, special_notes: null })
      .eq('id', pkg.id);

    if (updateErr) {
      console.error(`❌ ${pkg.short_code}: ${updateErr.message}`);
    } else {
      console.log(`✅ ${pkg.short_code}: → ${targetField}`);
      moved++;
    }
  }

  if (!DRY_RUN) {
    console.log(`\n📊 완료: ${moved}/${packages.length}건 이관`);
  } else {
    console.log(`\n[DRY-RUN 완료] 실제 반영하려면 --dry-run 없이 실행`);
  }
}

main().catch(console.error);
