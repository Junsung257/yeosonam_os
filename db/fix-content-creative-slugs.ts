/**
 * 깨진 content_creatives slug 10개를 UPDATE합니다.
 * 실행: npx tsx --env-file=.env.vercel db/fix-content-creative-slugs.ts
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('❌ Supabase 환경 변수가 없습니다.');
  console.error('   NEXT_PUBLIC_SUPABASE_URL 또는 SUPABASE_URL 필요');
  console.error('   SUPABASE_SERVICE_ROLE_KEY 필요');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SLUG_UPDATES: Record<string, string> = {
  '238dc4f6-039a-4243-aadd-a6c0345900e4': 'shimonoseki-fukuoka-beppu-preparation',
  '1cd353cb-c2f6-4b70-b2ac-899e05e3c523': 'kualalumpur-singapore-malacca-weather',
  '84ac3cf9-039a-4243-aadd-a6c0345900e4': 'shijiazhuang-currency-2',
  'b53c31f6-6cc3-418f-a42e-f0db20df8d47': 'vietnam-visa-free-2026',
  '7486a31d-e4ec-4254-8bf6-36dc4a9672c4': 'japan-entry-qa',
  '868fc898-3ff0-4ffa-aef8-ae50e65c4c4f': 'june-family-travel-best-3',
  '8a855e91-a833-4556-9b1c-b337a01fd2d1': 'june-sapporo-weather',
  '98544e75-c119-4c7b-84df-7a7333ef2f0f': 'travelwallet-vs-atm',
  '54335369-e546-423b-991b-c2443c190ad8': 'europe-etias',
  'dcf535e5-4efc-4306-8ae4-16e5e6ca3bcf': 'xian-huashan-4n5d-value-a99559',
};

async function main() {
  const ids = Object.keys(SLUG_UPDATES);
  console.log(`🔄 ${ids.length}개 content_creatives slug 업데이트 시작...\n`);

  for (const [id, slug] of Object.entries(SLUG_UPDATES)) {
    const { error, count } = await supabase
      .from('content_creatives')
      .update({ slug })
      .eq('id', id);

    if (error) {
      console.error(`❌ ${id} → "${slug}" 실패: ${error.message}`);
    } else {
      console.log(`✅ ${id} → "${slug}" (영향: ${count ?? '?'}행)`);
    }
  }

  console.log('\n📊 전체 완료. 위 로그에서 실패가 없으면 정상 처리된 것입니다.');
}

main().catch((err) => {
  console.error('스크립트 실행 중 오류:', err);
  process.exit(1);
});
