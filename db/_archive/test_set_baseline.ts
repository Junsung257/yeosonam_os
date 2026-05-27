/**
 * Test Set + Baseline 측정 (장가계 31c2a38b).
 * 사장님 화면 검수 + 이번 세션 5번 fix 한 history 기준 ground truth.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const PKG = '31c2a38b-8481-4674-a055-b11c96a7f948';

// 사장님 화면 확인 ground truth (이번 세션 5번 검증된 데이터)
const GROUND_TRUTH = {
  // TP — 매칭되어야 함 (라인 substring → expected attraction.name)
  positive: [
    { lineKeyword: '범정산 관광 (셔틀버스', expectedName: '범정산' },
    { lineKeyword: '동인시의 카르스트', expectedName: '동인대협곡' },
    { lineKeyword: '중국 4대 고성 중 하나로', expectedName: '봉황고성' },
    { lineKeyword: '장가계의 혼이라 불리는 천문산', expectedName: '천문산' },
    { lineKeyword: '천문산사(편도리프트)', expectedName: '천문산사' },
    { lineKeyword: '천문호선쇼 관람', expectedName: '천문호선쇼' },
    { lineKeyword: '72기루 관광', expectedName: '72기루' },
    { lineKeyword: '중국 최고의 협곡 장가계대협곡', expectedName: '장가계대협곡' },
    { lineKeyword: '케이블카로 천자산 등정', expectedName: '천자산' },
    { lineKeyword: '붓을 꽂아놓은 듯한 형상의 어필봉', expectedName: '어필봉' },
    { lineKeyword: '선녀와 같은 선녀헌화', expectedName: '선녀헌화' },
    { lineKeyword: '하룡장군의 동상이 있는 하룡공원', expectedName: '하룡공원' },
    { lineKeyword: '봉우리 2개가 연결되어 있는 천하제일교', expectedName: '천하제일교' },
    { lineKeyword: '미혼대, 후화원', expectedName: '미혼대' },
    { lineKeyword: '미혼대, 후화원', expectedName: '후화원' },
    { lineKeyword: '백룡엘리베이터(326M)', expectedName: '백룡엘리베이터' },
    { lineKeyword: '군성사석화박물관', expectedName: '군성사석화박물관' },
  ],
  // TN — skip 되어야 함 (매칭되면 false positive 사고)
  negative: [
    '부산 출발',
    '장가계 도착 / 가이드 미팅 후 중식',
    '동인으로 이동(4시간)',
    '도착 후 석식 및 호텔투숙',
    '조식 후 범정산으로 이동(1시간)',
    '동인대협곡으로 이동(1시간 10분)',
    '봉황고성으로 이동(1시간)',
    '석식 후 환상적인 고성의 야경 감상',
    '호텔투숙',
    '호텔 조식 후 장가계로 이동(3시간 30분)',
    '신선이 만든 듯한 기기묘묘한 봉우리들의 절경 감상',
    '999개의 계단위 하늘로 통하는 문 천문동',
    '호텔 투숙',
    '호텔 조식 후',
    '총길이 430M, 넓이 6M, 계곡에서의 높이 300M',
    '천자산 풍경구로 이동',
    '원가계로 이동',
    '여행의 피로를 풀어주는 발+전신마사지(90분/매너팁별도)',
    '장가계 출발',
    '부산 도착',
  ],
};

(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: pkg } = await supa.from('travel_packages').select('itinerary_data').eq('id', PKG).single();
  const days = (pkg as { itinerary_data?: { days?: Array<{ day: number; schedule?: Array<{ activity: string; attraction_ids?: string[] }> }> } })?.itinerary_data?.days ?? [];

  // 모든 라인 + attraction 이름 lookup
  type Item = { day: number; activity: string; matchedNames: string[] };
  const items: Item[] = [];
  for (const d of days) {
    for (const s of d.schedule ?? []) {
      const ids = s.attraction_ids ?? [];
      const names: string[] = [];
      for (const id of ids) {
        const { data: a } = await supa.from('attractions').select('name').eq('id', id).maybeSingle();
        if (a?.name) names.push(a.name as string);
      }
      items.push({ day: d.day, activity: s.activity, matchedNames: names });
    }
  }

  // ===== TP 측정 =====
  let tp = 0, fn = 0;
  const fnList: string[] = [];
  for (const gt of GROUND_TRUTH.positive) {
    const matched = items.find(i => i.activity.includes(gt.lineKeyword));
    if (!matched) { console.log(`  ⚠ GT 라인 못 찾음: ${gt.lineKeyword}`); continue; }
    if (matched.matchedNames.some(n => n === gt.expectedName || n.includes(gt.expectedName) || gt.expectedName.includes(n))) {
      tp++;
    } else {
      fn++;
      fnList.push(`${gt.expectedName} ← "${gt.lineKeyword}" (actual: [${matched.matchedNames.join(',') || '없음'}])`);
    }
  }

  // ===== TN / FP 측정 =====
  let tn = 0, fp = 0;
  const fpList: string[] = [];
  for (const negLine of GROUND_TRUTH.negative) {
    const item = items.find(i => i.activity === negLine || i.activity.startsWith(negLine.slice(0, 20)));
    if (!item) continue;
    if (item.matchedNames.length === 0) {
      tn++;
    } else {
      fp++;
      fpList.push(`"${negLine.slice(0, 40)}" → [${item.matchedNames.join(',')}]`);
    }
  }

  const total = tp + fn + tn + fp;
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  const f1 = 2 * precision * recall / Math.max(0.001, precision + recall);
  const accuracy = (tp + tn) / Math.max(1, total);

  console.log('═══ Baseline 측정 (31c2a38b 장가계, PR #117 적용 후) ═══');
  console.log(`  TP=${tp}/${GROUND_TRUTH.positive.length}  FN=${fn}  TN=${tn}/${GROUND_TRUTH.negative.length}  FP=${fp}`);
  console.log(`  Precision: ${(precision * 100).toFixed(0)}%`);
  console.log(`  Recall:    ${(recall * 100).toFixed(0)}%`);
  console.log(`  F1:        ${(f1 * 100).toFixed(0)}%`);
  console.log(`  Accuracy:  ${(accuracy * 100).toFixed(0)}%`);
  if (fnList.length) {
    console.log('\n  FN (놓친 매칭):');
    for (const f of fnList) console.log(`    - ${f}`);
  }
  if (fpList.length) {
    console.log('\n  FP (잘못 매칭):');
    for (const f of fpList) console.log(`    - ${f}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
