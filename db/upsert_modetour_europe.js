// Usage: node db/upsert_modetour_europe.js
// Upserts European attractions from 5 modetour products into Supabase

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================================
// 5 Products:
// 1. EENE91OZB2 - 동유럽+발칸11일 (체코/오스트리아/헝가리/크로아티아/슬로베니아)
// 2. EEE333KEV3 - 동유럽3국9일 (체코/헝가리/오스트리아)
// 3. EWE330TWCD - 서유럽3국10일 (프랑스/스위스/이탈리아)
// 4. EWE311TWGW - 스위스일주9일
// 5. EWE319TW1D - 이탈리아일주9일
// ============================================================

const attractions = [
  // =============================================
  // 헝가리 - 부다페스트
  // =============================================
  {
    name: "국회의사당(부다페스트)",
    short_desc: null,
    long_desc: null,
    country: "헝가리",
    region: "부다페스트",
    badge_type: "tour",
    emoji: "🏛️",
    category: "sightseeing",
    mention_count: 2
  },
  {
    name: "부다왕궁",
    short_desc: null,
    long_desc: null,
    country: "헝가리",
    region: "부다페스트",
    badge_type: "tour",
    emoji: "🏰",
    category: "palace",
    mention_count: 2
  },
  {
    name: "어부의요새",
    short_desc: null,
    long_desc: null,
    country: "헝가리",
    region: "부다페스트",
    badge_type: "tour",
    emoji: "🏰",
    category: "sightseeing",
    mention_count: 2
  },
  {
    name: "영웅광장",
    short_desc: null,
    long_desc: null,
    country: "헝가리",
    region: "부다페스트",
    badge_type: "tour",
    emoji: "🗽",
    category: "sightseeing",
    mention_count: 2
  },
  {
    name: "부다페스트야경투어",
    short_desc: null,
    long_desc: null,
    country: "헝가리",
    region: "부다페스트",
    badge_type: "special",
    emoji: "🌃",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "굴라쉬",
    short_desc: null,
    long_desc: null,
    country: "헝가리",
    region: "부다페스트",
    badge_type: "meal",
    emoji: "🍲",
    category: "meal",
    mention_count: 1
  },

  // =============================================
  // 크로아티아
  // =============================================
  {
    name: "자그레브대성당",
    short_desc: null,
    long_desc: null,
    country: "크로아티아",
    region: "자그레브",
    badge_type: "tour",
    emoji: "⛪",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "반젤라치크광장",
    short_desc: null,
    long_desc: null,
    country: "크로아티아",
    region: "자그레브",
    badge_type: "tour",
    emoji: "🏙️",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "성마르코성당",
    short_desc: null,
    long_desc: null,
    country: "크로아티아",
    region: "자그레브",
    badge_type: "tour",
    emoji: "⛪",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "돌의문",
    short_desc: null,
    long_desc: null,
    country: "크로아티아",
    region: "자그레브",
    badge_type: "tour",
    emoji: "🚪",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "플리트비체호수국립공원",
    short_desc: null,
    long_desc: null,
    country: "크로아티아",
    region: "플리트비체",
    badge_type: "tour",
    emoji: "💧",
    category: "nature",
    mention_count: 1
  },
  {
    name: "바다오르간",
    short_desc: null,
    long_desc: null,
    country: "크로아티아",
    region: "자다르",
    badge_type: "tour",
    emoji: "🎵",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "나로드니광장",
    short_desc: null,
    long_desc: null,
    country: "크로아티아",
    region: "자다르",
    badge_type: "tour",
    emoji: "🏙️",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "성아나스타샤성당",
    short_desc: null,
    long_desc: null,
    country: "크로아티아",
    region: "자다르",
    badge_type: "tour",
    emoji: "⛪",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "자다르구시가지",
    short_desc: null,
    long_desc: null,
    country: "크로아티아",
    region: "자다르",
    badge_type: "tour",
    emoji: "🏘️",
    category: "cultural",
    mention_count: 1
  },
  {
    name: "두브로브니크구시가지",
    short_desc: null,
    long_desc: null,
    country: "크로아티아",
    region: "두브로브니크",
    badge_type: "tour",
    emoji: "🏰",
    category: "cultural",
    mention_count: 1
  },
  {
    name: "프란체스코수도원",
    short_desc: null,
    long_desc: null,
    country: "크로아티아",
    region: "두브로브니크",
    badge_type: "tour",
    emoji: "🏛️",
    category: "cultural",
    mention_count: 1
  },
  {
    name: "오노플리안분수",
    short_desc: null,
    long_desc: null,
    country: "크로아티아",
    region: "두브로브니크",
    badge_type: "tour",
    emoji: "⛲",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "플라차거리",
    short_desc: null,
    long_desc: null,
    country: "크로아티아",
    region: "두브로브니크",
    badge_type: "tour",
    emoji: "🛤️",
    category: "cultural",
    mention_count: 1
  },
  {
    name: "스폰자궁",
    short_desc: null,
    long_desc: null,
    country: "크로아티아",
    region: "두브로브니크",
    badge_type: "tour",
    emoji: "🏛️",
    category: "palace",
    mention_count: 1
  },
  {
    name: "디오클레시안궁전",
    short_desc: null,
    long_desc: null,
    country: "크로아티아",
    region: "스플리트",
    badge_type: "tour",
    emoji: "🏛️",
    category: "palace",
    mention_count: 1
  },
  {
    name: "그레고리우스닌동상",
    short_desc: null,
    long_desc: null,
    country: "크로아티아",
    region: "스플리트",
    badge_type: "tour",
    emoji: "🗽",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "리바거리",
    short_desc: null,
    long_desc: null,
    country: "크로아티아",
    region: "스플리트",
    badge_type: "tour",
    emoji: "🌴",
    category: "cultural",
    mention_count: 1
  },
  {
    name: "성로렌스대성당(트로기르)",
    short_desc: null,
    long_desc: null,
    country: "크로아티아",
    region: "트로기르",
    badge_type: "tour",
    emoji: "⛪",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "시피코궁전",
    short_desc: null,
    long_desc: null,
    country: "크로아티아",
    region: "트로기르",
    badge_type: "tour",
    emoji: "🏛️",
    category: "palace",
    mention_count: 1
  },
  {
    name: "카메르렝고요새",
    short_desc: null,
    long_desc: null,
    country: "크로아티아",
    region: "트로기르",
    badge_type: "tour",
    emoji: "🏰",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "베프조바제브리카",
    short_desc: null,
    long_desc: null,
    country: "크로아티아",
    region: "크로아티아",
    badge_type: "meal",
    emoji: "🍖",
    category: "meal",
    mention_count: 1
  },

  // =============================================
  // 슬로베니아
  // =============================================
  {
    name: "세개의다리/프레셰렌광장(류블랴나)",
    short_desc: null,
    long_desc: null,
    country: "슬로베니아",
    region: "류블랴나",
    badge_type: "tour",
    emoji: "🌉",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "류블랴나대성당",
    short_desc: null,
    long_desc: null,
    country: "슬로베니아",
    region: "류블랴나",
    badge_type: "tour",
    emoji: "⛪",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "사랑의다리(류블랜야)",
    short_desc: null,
    long_desc: null,
    country: "슬로베니아",
    region: "류블랴나",
    badge_type: "tour",
    emoji: "🔒",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "블레드성",
    short_desc: null,
    long_desc: null,
    country: "슬로베니아",
    region: "블레드",
    badge_type: "tour",
    emoji: "🏰",
    category: "palace",
    mention_count: 1
  },
  {
    name: "블레드섬",
    short_desc: null,
    long_desc: null,
    country: "슬로베니아",
    region: "블레드",
    badge_type: "tour",
    emoji: "🏝️",
    category: "nature",
    mention_count: 1
  },

  // =============================================
  // 오스트리아
  // =============================================
  {
    name: "할슈타트",
    short_desc: null,
    long_desc: null,
    country: "오스트리아",
    region: "잘츠카머구트",
    badge_type: "tour",
    emoji: "🏘️",
    category: "nature",
    mention_count: 1
  },
  {
    name: "잘츠카머구트호수",
    short_desc: null,
    long_desc: null,
    country: "오스트리아",
    region: "잘츠카머구트",
    badge_type: "tour",
    emoji: "💧",
    category: "nature",
    mention_count: 1
  },
  {
    name: "잘츠카머구트유람선",
    short_desc: null,
    long_desc: null,
    country: "오스트리아",
    region: "잘츠카머구트",
    badge_type: "special",
    emoji: "🚢",
    category: "nature",
    mention_count: 1
  },
  {
    name: "미라벨정원",
    short_desc: null,
    long_desc: null,
    country: "오스트리아",
    region: "잘츠부르크",
    badge_type: "tour",
    emoji: "🌺",
    category: "park",
    mention_count: 2
  },
  {
    name: "게트라이데거리",
    short_desc: null,
    long_desc: null,
    country: "오스트리아",
    region: "잘츠부르크",
    badge_type: "tour",
    emoji: "🛍️",
    category: "shopping",
    mention_count: 2
  },
  {
    name: "모차르트생가",
    short_desc: null,
    long_desc: null,
    country: "오스트리아",
    region: "잘츠부르크",
    badge_type: "tour",
    emoji: "🎵",
    category: "museum",
    mention_count: 2
  },
  {
    name: "잘츠부르크대성당",
    short_desc: null,
    long_desc: null,
    country: "오스트리아",
    region: "잘츠부르크",
    badge_type: "tour",
    emoji: "⛪",
    category: "sightseeing",
    mention_count: 2
  },
  {
    name: "호엔잘츠부르크성",
    short_desc: null,
    long_desc: null,
    country: "오스트리아",
    region: "잘츠부르크",
    badge_type: "tour",
    emoji: "🏰",
    category: "palace",
    mention_count: 1
  },
  {
    name: "게른트너거리",
    short_desc: null,
    long_desc: null,
    country: "오스트리아",
    region: "비엔나",
    badge_type: "tour",
    emoji: "🛍️",
    category: "shopping",
    mention_count: 1
  },
  {
    name: "슈테판성당",
    short_desc: null,
    long_desc: null,
    country: "오스트리아",
    region: "비엔나",
    badge_type: "tour",
    emoji: "⛪",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "비엔나시청사/국회의사당",
    short_desc: null,
    long_desc: null,
    country: "오스트리아",
    region: "비엔나",
    badge_type: "tour",
    emoji: "🏛️",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "국립오페라극장",
    short_desc: null,
    long_desc: null,
    country: "오스트리아",
    region: "비엔나",
    badge_type: "tour",
    emoji: "🎭",
    category: "cultural",
    mention_count: 1
  },
  {
    name: "쉔부른궁전",
    short_desc: null,
    long_desc: null,
    country: "오스트리아",
    region: "비엔나",
    badge_type: "tour",
    emoji: "🏰",
    category: "palace",
    mention_count: 1
  },
  {
    name: "슈니첼",
    short_desc: null,
    long_desc: null,
    country: "오스트리아",
    region: "비엔나",
    badge_type: "meal",
    emoji: "🥩",
    category: "meal",
    mention_count: 1
  },
  {
    name: "호이리게",
    short_desc: null,
    long_desc: null,
    country: "오스트리아",
    region: "비엔나",
    badge_type: "meal",
    emoji: "🍷",
    category: "meal",
    mention_count: 1
  },
  {
    name: "스와로브스키크리스탈월드",
    short_desc: null,
    long_desc: null,
    country: "오스트리아",
    region: "인스부르크",
    badge_type: "tour",
    emoji: "💎",
    category: "museum",
    mention_count: 1
  },
  {
    name: "황금지붕(인스부르크)",
    short_desc: null,
    long_desc: null,
    country: "오스트리아",
    region: "인스부르크",
    badge_type: "tour",
    emoji: "✨",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "호프부르크궁전(인스부르크)",
    short_desc: null,
    long_desc: null,
    country: "오스트리아",
    region: "인스부르크",
    badge_type: "tour",
    emoji: "🏰",
    category: "palace",
    mention_count: 1
  },
  {
    name: "성야콥대성당",
    short_desc: null,
    long_desc: null,
    country: "오스트리아",
    region: "인스부르크",
    badge_type: "tour",
    emoji: "⛪",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "마리아테레지아거리",
    short_desc: null,
    long_desc: null,
    country: "오스트리아",
    region: "인스부르크",
    badge_type: "tour",
    emoji: "🛍️",
    category: "shopping",
    mention_count: 1
  },
  {
    name: "크리스탈월드3코스(다니엘스레스토랑)",
    short_desc: null,
    long_desc: null,
    country: "오스트리아",
    region: "인스부르크",
    badge_type: "meal",
    emoji: "🍽️",
    category: "meal",
    mention_count: 1
  },

  // =============================================
  // 체코
  // =============================================
  {
    name: "체스키크룸로프성",
    short_desc: null,
    long_desc: null,
    country: "체코",
    region: "체스키크룸로프",
    badge_type: "tour",
    emoji: "🏰",
    category: "palace",
    mention_count: 2
  },
  {
    name: "망토다리",
    short_desc: null,
    long_desc: null,
    country: "체코",
    region: "체스키크룸로프",
    badge_type: "tour",
    emoji: "🌉",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "이발사의다리",
    short_desc: null,
    long_desc: null,
    country: "체코",
    region: "체스키크룸로프",
    badge_type: "tour",
    emoji: "🌉",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "프라하야경투어",
    short_desc: null,
    long_desc: null,
    country: "체코",
    region: "프라하",
    badge_type: "special",
    emoji: "🌃",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "프라하성",
    short_desc: null,
    long_desc: null,
    country: "체코",
    region: "프라하",
    badge_type: "tour",
    emoji: "🏰",
    category: "palace",
    mention_count: 2
  },
  {
    name: "카를교",
    short_desc: null,
    long_desc: null,
    country: "체코",
    region: "프라하",
    badge_type: "tour",
    emoji: "🌉",
    category: "sightseeing",
    mention_count: 2
  },
  {
    name: "시청사와천문시계",
    short_desc: null,
    long_desc: null,
    country: "체코",
    region: "프라하",
    badge_type: "tour",
    emoji: "🕰️",
    category: "sightseeing",
    mention_count: 2
  },
  {
    name: "바츨라프광장",
    short_desc: null,
    long_desc: null,
    country: "체코",
    region: "프라하",
    badge_type: "tour",
    emoji: "🏙️",
    category: "sightseeing",
    mention_count: 2
  },
  {
    name: "틴교회",
    short_desc: null,
    long_desc: null,
    country: "체코",
    region: "프라하",
    badge_type: "tour",
    emoji: "⛪",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "프라하트램",
    short_desc: null,
    long_desc: null,
    country: "체코",
    region: "프라하",
    badge_type: "tour",
    emoji: "🚃",
    category: "cultural",
    mention_count: 1
  },
  {
    name: "구시청사(부르노)",
    short_desc: null,
    long_desc: null,
    country: "체코",
    region: "브르노",
    badge_type: "tour",
    emoji: "🏛️",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "성베드로와바오로대성당(부르노)",
    short_desc: null,
    long_desc: null,
    country: "체코",
    region: "브르노",
    badge_type: "tour",
    emoji: "⛪",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "자유광장(부르노)",
    short_desc: null,
    long_desc: null,
    country: "체코",
    region: "브르노",
    badge_type: "tour",
    emoji: "🏙️",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "스비치코바",
    short_desc: null,
    long_desc: null,
    country: "체코",
    region: "프라하",
    badge_type: "meal",
    emoji: "🍖",
    category: "meal",
    mention_count: 1
  },

  // =============================================
  // 프랑스
  // =============================================
  {
    name: "베르사유궁전",
    short_desc: null,
    long_desc: null,
    country: "프랑스",
    region: "파리",
    badge_type: "tour",
    emoji: "🏰",
    category: "palace",
    mention_count: 1
  },
  {
    name: "파리개선문",
    short_desc: null,
    long_desc: null,
    country: "프랑스",
    region: "파리",
    badge_type: "tour",
    emoji: "🗼",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "샹제리제거리",
    short_desc: null,
    long_desc: null,
    country: "프랑스",
    region: "파리",
    badge_type: "tour",
    emoji: "🛍️",
    category: "shopping",
    mention_count: 1
  },
  {
    name: "콩코드광장",
    short_desc: null,
    long_desc: null,
    country: "프랑스",
    region: "파리",
    badge_type: "tour",
    emoji: "🗽",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "에펠탑",
    short_desc: null,
    long_desc: null,
    country: "프랑스",
    region: "파리",
    badge_type: "tour",
    emoji: "🗼",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "루브르박물관",
    short_desc: null,
    long_desc: null,
    country: "프랑스",
    region: "파리",
    badge_type: "tour",
    emoji: "🎨",
    category: "museum",
    mention_count: 1
  },
  {
    name: "에펠탑2층전망대+세느강유람선",
    short_desc: null,
    long_desc: null,
    country: "프랑스",
    region: "파리",
    badge_type: "optional",
    emoji: "🚢",
    category: "sightseeing",
    price_info: { currency: "EUR", price: 110, note: "현지 선택관광" },
    mention_count: 1
  },
  {
    name: "몽마르뜨언덕투어",
    short_desc: null,
    long_desc: null,
    country: "프랑스",
    region: "파리",
    badge_type: "optional",
    emoji: "🎨",
    category: "cultural",
    price_info: { currency: "EUR", price: 40, note: "현지 선택관광" },
    mention_count: 1
  },
  {
    name: "에스까르고+부르기뇽",
    short_desc: null,
    long_desc: null,
    country: "프랑스",
    region: "파리",
    badge_type: "meal",
    emoji: "🐌",
    category: "meal",
    mention_count: 1
  },
  {
    name: "TGV초고속열차",
    short_desc: null,
    long_desc: null,
    country: "프랑스",
    region: "프랑스",
    badge_type: "special",
    emoji: "🚄",
    category: "cultural",
    mention_count: 1
  },

  // =============================================
  // 스위스
  // =============================================
  {
    name: "카펠교(루체른)",
    short_desc: null,
    long_desc: null,
    country: "스위스",
    region: "루체른",
    badge_type: "tour",
    emoji: "🌉",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "빈사의사자상",
    short_desc: null,
    long_desc: null,
    country: "스위스",
    region: "루체른",
    badge_type: "tour",
    emoji: "🦁",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "루체른유람선",
    short_desc: null,
    long_desc: null,
    country: "스위스",
    region: "루체른",
    badge_type: "optional",
    emoji: "🚢",
    category: "nature",
    price_info: { currency: "EUR", price: 60, note: "현지 선택관광" },
    mention_count: 1
  },
  {
    name: "융프라우요흐",
    short_desc: null,
    long_desc: null,
    country: "스위스",
    region: "인터라켄",
    badge_type: "tour",
    emoji: "🏔️",
    category: "nature",
    mention_count: 1
  },
  {
    name: "아이거익스프레스",
    short_desc: null,
    long_desc: null,
    country: "스위스",
    region: "인터라켄",
    badge_type: "tour",
    emoji: "🚡",
    category: "nature",
    mention_count: 1
  },
  {
    name: "라인폭포",
    short_desc: null,
    long_desc: null,
    country: "스위스",
    region: "샤프하우젠",
    badge_type: "tour",
    emoji: "💦",
    category: "nature",
    mention_count: 1
  },
  {
    name: "그로스뮌스터",
    short_desc: null,
    long_desc: null,
    country: "스위스",
    region: "취리히",
    badge_type: "tour",
    emoji: "⛪",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "린덴호프공원",
    short_desc: null,
    long_desc: null,
    country: "스위스",
    region: "취리히",
    badge_type: "tour",
    emoji: "🌳",
    category: "park",
    mention_count: 1
  },
  {
    name: "린트초콜렛박물관",
    short_desc: null,
    long_desc: null,
    country: "스위스",
    region: "취리히",
    badge_type: "tour",
    emoji: "🍫",
    category: "museum",
    mention_count: 1
  },
  {
    name: "리기산",
    short_desc: null,
    long_desc: null,
    country: "스위스",
    region: "루체른",
    badge_type: "tour",
    emoji: "🏔️",
    category: "nature",
    mention_count: 1
  },
  {
    name: "체르마트시내",
    short_desc: null,
    long_desc: null,
    country: "스위스",
    region: "체르마트",
    badge_type: "tour",
    emoji: "🏘️",
    category: "nature",
    mention_count: 1
  },
  {
    name: "마테호른",
    short_desc: null,
    long_desc: null,
    country: "스위스",
    region: "체르마트",
    badge_type: "tour",
    emoji: "🏔️",
    category: "nature",
    mention_count: 1
  },
  {
    name: "로이커바트온천",
    short_desc: null,
    long_desc: null,
    country: "스위스",
    region: "발레",
    badge_type: "onsen",
    emoji: "♨️",
    category: "nature",
    mention_count: 1
  },
  {
    name: "겜미패스",
    short_desc: null,
    long_desc: null,
    country: "스위스",
    region: "발레",
    badge_type: "tour",
    emoji: "🏔️",
    category: "nature",
    mention_count: 1
  },
  {
    name: "몽트뢰",
    short_desc: null,
    long_desc: null,
    country: "스위스",
    region: "몽트뢰",
    badge_type: "tour",
    emoji: "🎵",
    category: "cultural",
    mention_count: 1
  },
  {
    name: "시옹성",
    short_desc: null,
    long_desc: null,
    country: "스위스",
    region: "몽트뢰",
    badge_type: "tour",
    emoji: "🏰",
    category: "palace",
    mention_count: 1
  },
  {
    name: "베른시계탑",
    short_desc: null,
    long_desc: null,
    country: "스위스",
    region: "베른",
    badge_type: "tour",
    emoji: "🕰️",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "곰공원",
    short_desc: null,
    long_desc: null,
    country: "스위스",
    region: "베른",
    badge_type: "tour",
    emoji: "🐻",
    category: "park",
    mention_count: 1
  },
  {
    name: "리기산레스토랑식사(감자전+막걸리)",
    short_desc: null,
    long_desc: null,
    country: "스위스",
    region: "루체른",
    badge_type: "meal",
    emoji: "🥔",
    category: "meal",
    mention_count: 1
  },
  {
    name: "겜미패스레스토랑(뢰스티3코스)",
    short_desc: null,
    long_desc: null,
    country: "스위스",
    region: "발레",
    badge_type: "meal",
    emoji: "🥔",
    category: "meal",
    mention_count: 1
  },
  {
    name: "치즈퐁듀",
    short_desc: null,
    long_desc: null,
    country: "스위스",
    region: "스위스",
    badge_type: "meal",
    emoji: "🧀",
    category: "meal",
    mention_count: 1
  },
  {
    name: "브라트부르스트&뢰스티",
    short_desc: null,
    long_desc: null,
    country: "스위스",
    region: "스위스",
    badge_type: "meal",
    emoji: "🌭",
    category: "meal",
    mention_count: 1
  },

  // =============================================
  // 이탈리아
  // =============================================
  {
    name: "산마르코광장",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "베네치아",
    badge_type: "tour",
    emoji: "🏛️",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "산마르코성당",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "베네치아",
    badge_type: "tour",
    emoji: "⛪",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "탄식의다리",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "베네치아",
    badge_type: "tour",
    emoji: "🌉",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "두칼레궁전",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "베네치아",
    badge_type: "tour",
    emoji: "🏛️",
    category: "palace",
    mention_count: 1
  },
  {
    name: "베니스곤돌라",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "베네치아",
    badge_type: "optional",
    emoji: "🛶",
    category: "cultural",
    price_info: { currency: "EUR", price: 60, note: "현지 선택관광" },
    mention_count: 1
  },
  {
    name: "베니스수상택시",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "베네치아",
    badge_type: "optional",
    emoji: "🚤",
    category: "cultural",
    price_info: { currency: "EUR", price: 60, note: "현지 선택관광" },
    mention_count: 1
  },
  {
    name: "노벤타아울렛",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "베네치아",
    badge_type: "shopping",
    emoji: "🛍️",
    category: "shopping",
    mention_count: 2
  },
  {
    name: "두오모성당(피렌체)",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "피렌체",
    badge_type: "tour",
    emoji: "⛪",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "시뇨리아광장",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "피렌체",
    badge_type: "tour",
    emoji: "🏛️",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "단테생가",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "피렌체",
    badge_type: "tour",
    emoji: "🏘️",
    category: "cultural",
    mention_count: 1
  },
  {
    name: "베키오다리",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "피렌체",
    badge_type: "tour",
    emoji: "🌉",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "산조반니세례당",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "피렌체",
    badge_type: "tour",
    emoji: "⛪",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "피오렌티나스테이크",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "피렌체",
    badge_type: "meal",
    emoji: "🥩",
    category: "meal",
    mention_count: 2
  },
  {
    name: "바티칸박물관",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "로마",
    badge_type: "tour",
    emoji: "🎨",
    category: "museum",
    mention_count: 1
  },
  {
    name: "시스티나예배당",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "로마",
    badge_type: "tour",
    emoji: "🎨",
    category: "museum",
    mention_count: 1
  },
  {
    name: "성베드로대성당",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "로마",
    badge_type: "tour",
    emoji: "⛪",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "성베드로광장",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "로마",
    badge_type: "tour",
    emoji: "🏛️",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "콜로세움",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "로마",
    badge_type: "tour",
    emoji: "🏛️",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "포로로마노",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "로마",
    badge_type: "tour",
    emoji: "🏛️",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "트레비분수",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "로마",
    badge_type: "tour",
    emoji: "⛲",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "로마벤츠투어",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "로마",
    badge_type: "optional",
    emoji: "🚗",
    category: "sightseeing",
    price_info: { currency: "EUR", price: 70, note: "현지 선택관광" },
    mention_count: 1
  },
  {
    name: "폼페이",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "나폴리",
    badge_type: "tour",
    emoji: "🏛️",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "소렌토",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "나폴리",
    badge_type: "tour",
    emoji: "🍋",
    category: "nature",
    mention_count: 1
  },
  {
    name: "해물튀김(폼페이)",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "나폴리",
    badge_type: "meal",
    emoji: "🍤",
    category: "meal",
    mention_count: 1
  },
  {
    name: "아말피해안도로",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "아말피",
    badge_type: "tour",
    emoji: "🛤️",
    category: "nature",
    mention_count: 1
  },
  {
    name: "포지타노",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "아말피",
    badge_type: "tour",
    emoji: "🏘️",
    category: "nature",
    mention_count: 1
  },
  {
    name: "아씨시",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "움브리아",
    badge_type: "tour",
    emoji: "⛪",
    category: "cultural",
    mention_count: 1
  },
  {
    name: "시르미오네",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "가르다호수",
    badge_type: "tour",
    emoji: "🏰",
    category: "nature",
    mention_count: 1
  },
  {
    name: "아레나원형경기장(베로나)",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "베로나",
    badge_type: "tour",
    emoji: "🏛️",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "줄리엣생가",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "베로나",
    badge_type: "tour",
    emoji: "💕",
    category: "cultural",
    mention_count: 1
  },
  {
    name: "산지미냐노",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "토스카나",
    badge_type: "tour",
    emoji: "🏰",
    category: "cultural",
    mention_count: 1
  },
  {
    name: "두오모(오르비에또)",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "움브리아",
    badge_type: "tour",
    emoji: "⛪",
    category: "sightseeing",
    mention_count: 1
  },
  {
    name: "오르비에또골목",
    short_desc: null,
    long_desc: null,
    country: "이탈리아",
    region: "움브리아",
    badge_type: "tour",
    emoji: "🏘️",
    category: "cultural",
    mention_count: 1
  },

  // =============================================
  // 독일/프랑스(스위스일주 코스 포함)
  // =============================================
  {
    name: "스트라스부르",
    short_desc: null,
    long_desc: null,
    country: "프랑스",
    region: "알자스",
    badge_type: "tour",
    emoji: "🏘️",
    category: "cultural",
    mention_count: 1
  },
  {
    name: "하이델베르크고성",
    short_desc: null,
    long_desc: null,
    country: "독일",
    region: "하이델베르크",
    badge_type: "tour",
    emoji: "🏰",
    category: "palace",
    mention_count: 1
  },
  {
    name: "하이델베르크대학가",
    short_desc: null,
    long_desc: null,
    country: "독일",
    region: "하이델베르크",
    badge_type: "tour",
    emoji: "🎓",
    category: "cultural",
    mention_count: 1
  }
];

async function main() {
  console.log(`Upserting ${attractions.length} European attractions...`);

  // Upsert in batches of 50
  const BATCH = 50;
  let totalUpserted = 0;

  for (let i = 0; i < attractions.length; i += BATCH) {
    const batch = attractions.slice(i, i + BATCH);
    const { error } = await sb
      .from('attractions')
      .upsert(batch, { onConflict: 'name' });

    if (error) {
      console.error(`Batch ${Math.floor(i / BATCH) + 1} error:`, error.message);
    } else {
      totalUpserted += batch.length;
      console.log(`Batch ${Math.floor(i / BATCH) + 1}: ${batch.length} upserted`);
    }
  }

  console.log(`\nTotal upserted: ${totalUpserted}`);

  // Get total count in DB
  const { count, error: countError } = await sb
    .from('attractions')
    .select('*', { count: 'exact', head: true });

  if (countError) {
    console.error('Count error:', countError.message);
  } else {
    console.log(`Total attractions in DB: ${count}`);
  }
}

main().catch(console.error);
