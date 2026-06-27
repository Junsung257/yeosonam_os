import './load-script-env';
import { supabaseAdmin } from '../src/lib/supabase';

const candidates = [
  { name: '사이샹 옛거리', region: '호화호특', country: 'CN', aliases: ['사이샹옛거리'], short_desc: '호화호특 지역의 옛 거리 분위기를 볼 수 있는 산책 관광지입니다.' },
  { name: '멍량풍정원', region: '호화호특', country: 'CN', aliases: ['멍량풍정원', '몽량풍정원'], short_desc: '내몽고 민속 분위기와 전통문화를 둘러보는 관광지입니다.' },
  { name: '천문동', region: '장가계', country: 'CN', aliases: ['개의계단위하늘로통하는문천문동', '하늘로통하는문', '천문산 천문동'], short_desc: '장가계 천문산의 대표 절경으로 알려진 천연 석문 관광지입니다.' },
  { name: '달랏 플라워가든', region: '달랏', country: 'VN', aliases: ['플라워가든', '꽃정원'], short_desc: '달랏의 다양한 꽃과 정원을 둘러보는 대표 정원 관광지입니다.' },
  { name: '토가풍정원', region: '장가계', country: 'CN', aliases: ['토가족풍정원', '토가족들의 생활을 엿볼 수 있는 토가족풍정원'], short_desc: '토가족 전통 생활과 민속문화를 소개하는 장가계 관광지입니다.' },
  { name: '가루다 위시누 켄카나 문화공원', region: '발리', country: 'ID', aliases: ['가루다 국립공원', '가루다상', '비쉬누상', 'GWK 문화공원'], short_desc: '발리의 대형 조각상과 전통 공연을 함께 볼 수 있는 문화공원입니다.' },
  { name: '모아산국가 삼림공원', region: '연길', country: 'CN', aliases: ['모아산', '모아산 국가삼림공원'], short_desc: '연길 일대의 숲과 전망을 즐길 수 있는 삼림공원입니다.' },
  { name: '아타미 매화원', region: '아타미', country: 'JP', aliases: ['아타미매화원'], short_desc: '아타미를 대표하는 매화 명소로 계절 산책에 적합한 정원입니다.' },
  { name: '아타미 친수공원', region: '아타미', country: 'JP', aliases: ['아타미친수공원'], short_desc: '아타미 해안가에 조성된 산책 공원입니다.' },
  { name: '슈젠지', region: '시즈오카', country: 'JP', aliases: ['수선사', '修善寺'], short_desc: '이즈 지역의 온천 마을과 함께 둘러보는 고찰입니다.' },
  { name: '오와쿠다니 유황계곡', region: '하코네', country: 'JP', aliases: ['오와쿠다니', '오와쿠다니 계곡'], short_desc: '화산 지형과 유황 연기를 볼 수 있는 하코네 대표 명소입니다.' },
  { name: '긴린호수', region: '유후인', country: 'JP', aliases: ['긴린 호수', '킨린호수'], short_desc: '유후인의 대표 호수로 산책과 풍경 감상에 적합한 명소입니다.' },
  { name: '마이즈루 공원', region: '후쿠오카', country: 'JP', aliases: ['후쿠오카 성터가 남아있는 꽃놀이 명소 마이즈루 공원'], short_desc: '후쿠오카 성터 주변에 조성된 공원으로 벚꽃 명소로도 알려져 있습니다.' },
  { name: '하노이 시내 관광', region: '하노이', country: 'VN', aliases: ['호치민생가', '한기둥사원', '바딘광장'], short_desc: '하노이의 대표 역사 명소를 둘러보는 시내 관광 코스입니다.' },
  { name: '옥산사', region: '하노이', country: 'VN', aliases: ['옥산사 대체진행'], short_desc: '하노이 호안끼엠 호수 인근의 대표 사당 관광지입니다.' },
  { name: '옌뜨', region: '하롱', country: 'VN', aliases: ['옌뜨국립공원', '옌뜨 국립공원'], short_desc: '베트남 북부의 산악 불교 성지로 케이블카 관광이 진행되는 명소입니다.' },
  { name: '항루언', region: '하롱베이', country: 'VN', aliases: ['항루원', '항루언 비경관광'], short_desc: '하롱베이에서 보트로 둘러보는 석회암 절경 구역입니다.' },
  { name: '하롱 석회동굴', region: '하롱베이', country: 'VN', aliases: ['석회동굴', '하늘문', '용모양 궁전기둥', '선녀탕'], short_desc: '하롱베이 일대의 석회암 지형과 동굴 경관을 감상하는 관광 코스입니다.' },
  { name: '하롱테마파크', region: '하롱', country: 'VN', aliases: ['하롱 테마파크'], short_desc: '하롱 지역의 케이블카와 놀이시설을 함께 즐길 수 있는 테마파크입니다.' },
  { name: '패치워크의 길', region: '비에이', country: 'JP', aliases: ['패치워크 길'], short_desc: '비에이의 구릉과 농장 풍경을 차창으로 감상하는 대표 드라이브 코스입니다.' },
  { name: '통천호', region: '임주', country: 'CN', aliases: ['석방부두', '희수광장', '천하호구', '금귀교', '용세담', '금귀호'], short_desc: '임주 지역 일정에서 유람과 풍경 감상을 진행하는 호수 관광지입니다.' },
  { name: '환산선 풍경구', region: '임주', country: 'CN', aliases: ['환산선 풍경구 일주'], short_desc: '전동카로 산악 풍경을 둘러보는 임주 지역 풍경구입니다.' },
  { name: '보천 풍경구', region: '임주', country: 'CN', aliases: ['황용담', '함주', '일월유천', '이용희주', '구련폭포'], short_desc: '태항산 일정에서 계곡과 폭포 경관을 둘러보는 풍경구입니다.' },
  { name: '천계산', region: '임주', country: 'CN', aliases: ['천갱', '성녀봉', '수녀봉', '불어대'], short_desc: '태항산 일대의 봉우리와 협곡 경관을 감상하는 산악 관광지입니다.' },
  { name: '융드레우물', region: '용정', country: 'CN', aliases: ['용정지역의 기원인 융드레우물'], short_desc: '용정 지명의 유래와 관련된 지역 명소입니다.' },
  { name: '바오다이 황제 여름별장', region: '달랏', country: 'VN', aliases: ['바오다이 황제의 여름별장'], short_desc: '베트남 마지막 황제 바오다이의 달랏 여름 별장입니다.' },
];

const rows = candidates.map(candidate => ({
  ...candidate,
  category: 'attraction',
  badge_type: 'tour',
  is_active: true,
  customer_publishable: true,
  auto_created: true,
  auto_created_at: new Date().toISOString(),
  source: 'hwp-product-registration-batch',
  verification_status: 'manual',
  raw_descriptions: [candidate.short_desc],
  source_ids: { batch: 'hwp-inbox-2026-06-26' },
  verification_sources: ['HWP supplier itinerary text'],
}));

async function main() {
  const { data, error } = await supabaseAdmin
    .from('attractions')
    .upsert(rows, { onConflict: 'name' })
    .select('name');

  if (error) throw error;

  console.log(JSON.stringify({ upserted: data?.length ?? 0, names: data?.map(row => row.name) ?? [] }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
