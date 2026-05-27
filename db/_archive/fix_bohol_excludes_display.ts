/**
 * 보홀 슬림팩 — excludes 식사·일차 표기 DB 정규화
 * 실행: npx tsx --env-file=.env.local db/fix_bohol_excludes_display.ts
 */
import { createClient } from '@supabase/supabase-js';
import { extractBullets } from '../src/lib/parser/deterministic/bullets';
import { repairMealDayExcludeItems } from '../src/lib/parser/deterministic/comma-split-safe';
import { looksLikeCommaSplitBroken } from '../src/lib/parser/deterministic/comma-split-signature';

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const IDS = ['e740822c-df2b-4a58-83de-ea07cc94e23b', '3646b8bb-9c5f-4a9f-bf11-999ea0c42a32'];

function normalizeExcludes(rawText: string, current: unknown): string[] {
  const bullets = extractBullets(rawText).excludes;
  if (bullets.length > 0) return bullets;
  if (!Array.isArray(current)) return [];
  return repairMealDayExcludeItems(current.filter((x): x is string => typeof x === 'string'));
}

(async () => {
  for (const id of IDS) {
    const { data, error } = await sb
      .from('travel_packages')
      .select('id, internal_code, title, raw_text, excludes')
      .eq('id', id)
      .single();
    if (error || !data) {
      console.error(id, error?.message ?? 'not found');
      continue;
    }
    const next = normalizeExcludes(data.raw_text ?? '', data.excludes);
    console.log(`\n${data.internal_code} ${data.title}`);
    console.log('  before:', JSON.stringify(data.excludes));
    console.log('  after: ', JSON.stringify(next));
    if (JSON.stringify(data.excludes) === JSON.stringify(next)) {
      console.log('  (unchanged)');
      continue;
    }
    const { error: uErr } = await sb.from('travel_packages').update({ excludes: next }).eq('id', id);
    if (uErr) console.error('  ✗', uErr.message);
    else console.log('  ✓ updated');
  }
})();
