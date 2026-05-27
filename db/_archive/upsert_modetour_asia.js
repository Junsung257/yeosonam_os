// Usage: node db/upsert_modetour_asia.js
// Upserts Chinese, Hong Kong, Macau, and Mongolian attractions into Supabase

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================================
// ZHANGJIAJIE (장가계) - 2 products
// ============================================================
const zhangjiajie = [
  // Tour
  { name: '천문산(케이블카7455m)', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'tour', emoji: '🏔️', category: 'nature', mention_count: 2 },
  { name: '천문산사', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'tour', emoji: '🛕', category: 'temple', mention_count: 2 },
  { name: '귀곡잔도', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'tour', emoji: '🥾', category: 'nature', mention_count: 2 },
  { name: '천문산유리잔도', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'tour', emoji: '🪟', category: 'nature', mention_count: 2 },
  { name: '칠성산', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'tour', emoji: '⛰️', category: 'nature', mention_count: 2 },
  { name: '칠성산유리잔도', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'tour', emoji: '🪟', category: 'nature', mention_count: 2 },
  { name: '72기루', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'tour', emoji: '🏔️', category: 'nature', mention_count: 2 },
  { name: '보봉호', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'tour', emoji: '🚢', category: 'nature', mention_count: 2 },
  { name: '천자산', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'tour', emoji: '⛰️', category: 'nature', mention_count: 2 },
  { name: '하룡공원', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'tour', emoji: '🏞️', category: 'park', mention_count: 2 },
  { name: '어필봉', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'tour', emoji: '🪨', category: 'nature', mention_count: 2 },
  { name: '원가계(아바타촬영지)', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'tour', emoji: '🎬', category: 'nature', mention_count: 2 },
  { name: '천하제일교', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'tour', emoji: '🌉', category: 'nature', mention_count: 2 },
  { name: '미혼대', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'tour', emoji: '🏔️', category: 'nature', mention_count: 2 },
  { name: '백룡엘리베이터', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'tour', emoji: '🛗', category: 'sightseeing', mention_count: 2 },
  { name: '금편계곡', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'tour', emoji: '🏞️', category: 'nature', mention_count: 2 },
  { name: '십리화랑', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'tour', emoji: '🚝', category: 'nature', mention_count: 2 },
  { name: '유리다리(대협곡)', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'tour', emoji: '🌉', category: 'nature', mention_count: 2 },
  { name: '대협곡(유람선)', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'tour', emoji: '🚢', category: 'nature', mention_count: 2 },
  { name: '백장협', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'tour', emoji: '🏞️', category: 'nature', mention_count: 2 },
  { name: '황룡동굴', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'tour', emoji: '🕳️', category: 'nature', mention_count: 2 },
  { name: '군성사석화', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'tour', emoji: '🪨', category: 'nature', mention_count: 2 },
  // Activity
  { name: '천문산케이블카', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'activity', emoji: '🚡', category: 'activity', mention_count: 2 },
  { name: '백룡엘리베이터탑승', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'activity', emoji: '🛗', category: 'activity', mention_count: 2 },
  { name: '십리화랑모노레일', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'activity', emoji: '🚝', category: 'activity', mention_count: 2 },
  { name: '보봉호유람선', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'activity', emoji: '🛥️', category: 'activity', mention_count: 2 },
  // Special
  { name: '천문호선쇼(매력상서쇼)', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'special', emoji: '🎭', category: 'entertainment', mention_count: 2 },
  { name: '장가계공항VIP라운지', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'special', emoji: '✈️', category: 'service', mention_count: 2 },
  { name: '전신마사지60분(장가계)', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'special', emoji: '💆', category: 'wellness', mention_count: 2 },
  // Hotel
  { name: '장가계썬샤인호텔(양광호텔)', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '장가계피닉스호텔', short_desc: null, long_desc: null, country: '중국', region: '장가계', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '무한건국호텔', short_desc: null, long_desc: null, country: '중국', region: '무한', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
];

// ============================================================
// QINGDAO (청도) - 2 products
// ============================================================
const qingdao = [
  // Tour
  { name: '청도맥주박물관', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'tour', emoji: '🍺', category: 'museum', mention_count: 2 },
  { name: '찌모루시장', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'tour', emoji: '🏪', category: 'cultural', mention_count: 2 },
  { name: '소어산공원(전망대)', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'tour', emoji: '🏔️', category: 'sightseeing', mention_count: 2 },
  { name: '5.4광장', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'tour', emoji: '🏛️', category: 'sightseeing', mention_count: 2 },
  { name: '청도올림픽요트경기장', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'tour', emoji: '⛵', category: 'sightseeing', mention_count: 2 },
  { name: '팔대관', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'tour', emoji: '🏛️', category: 'cultural', mention_count: 2 },
  { name: '청도스카이씨뷰(해천뷰타워)', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'tour', emoji: '🗼', category: 'sightseeing', mention_count: 2 },
  { name: '노산거봉풍경구(케이블카)', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'tour', emoji: '🚡', category: 'nature', mention_count: 2 },
  { name: '지묵고성', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'tour', emoji: '🏯', category: 'cultural', mention_count: 2 },
  { name: '명월산해간불야성', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'tour', emoji: '🌃', category: 'entertainment', mention_count: 2 },
  { name: '대복도(따빠오따오)', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'tour', emoji: '🏖️', category: 'nature', mention_count: 2 },
  { name: '천주교당', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'tour', emoji: '⛪', category: 'cultural', mention_count: 2 },
  { name: '잔교', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'tour', emoji: '🌊', category: 'sightseeing', mention_count: 2 },
  { name: '신호산(전망대)', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'tour', emoji: '🏔️', category: 'sightseeing', mention_count: 2 },
  { name: '영빈관', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'tour', emoji: '🏛️', category: 'cultural', mention_count: 2 },
  { name: '지브리벽화거리', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'tour', emoji: '🎨', category: 'cultural', mention_count: 2 },
  { name: '극지대관람차', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'tour', emoji: '🎡', category: 'entertainment', mention_count: 2 },
  { name: '타이동거리(야시장)', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'tour', emoji: '🌃', category: 'shopping', mention_count: 2 },
  { name: '중산로', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'tour', emoji: '🏛️', category: 'cultural', mention_count: 2 },
  { name: '실버피시스트리트(은어항)', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'tour', emoji: '🐟', category: 'cultural', mention_count: 2 },
  { name: '798예술구(청도)', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'tour', emoji: '🎨', category: 'cultural', mention_count: 1 },
  { name: '세무천계(청도)', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'tour', emoji: '📺', category: 'entertainment', mention_count: 1 },
  // Activity
  { name: '노산케이블카', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'activity', emoji: '🚡', category: 'activity', mention_count: 2 },
  // Meal
  { name: '양꼬치무제한(+칭다오맥주)', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'meal', emoji: '🍖', category: 'meal', mention_count: 2 },
  { name: '인터컨티넨탈디너뷔페', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'meal', emoji: '🍽️', category: 'meal', mention_count: 2 },
  { name: '사천요리', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'meal', emoji: '🌶️', category: 'meal', mention_count: 2 },
  { name: '산동요리', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'meal', emoji: '🥘', category: 'meal', mention_count: 2 },
  { name: '무제한삼겹살(청도)', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'meal', emoji: '🥩', category: 'meal', mention_count: 2 },
  // Hotel
  { name: '청도지묵더블트리힐튼', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '청도MGM호텔', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  // Special
  { name: '전신마사지60분(청도)', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'special', emoji: '💆', category: 'wellness', mention_count: 2 },
  { name: '청도야시장투어', short_desc: null, long_desc: null, country: '중국', region: '청도', badge_type: 'special', emoji: '🌃', category: 'entertainment', mention_count: 2 },
];

// ============================================================
// SHANDONG PENINSULA (산동반도: 청도/연태/위해) - 1 product
// ============================================================
const shandong = [
  // Tour
  { name: '연태천마잔교', short_desc: null, long_desc: null, country: '중국', region: '연태', badge_type: 'tour', emoji: '🌊', category: 'sightseeing', mention_count: 1 },
  { name: '소성리옛거리', short_desc: null, long_desc: null, country: '중국', region: '연태', badge_type: 'tour', emoji: '🏘️', category: 'cultural', mention_count: 1 },
  { name: '피셔맨즈와프(연태)', short_desc: null, long_desc: null, country: '중국', region: '연태', badge_type: 'tour', emoji: '🚢', category: 'cultural', mention_count: 1 },
  { name: '장유와인박물관', short_desc: null, long_desc: null, country: '중국', region: '연태', badge_type: 'tour', emoji: '🍷', category: 'museum', mention_count: 1 },
  { name: '연태고량주박물관', short_desc: null, long_desc: null, country: '중국', region: '연태', badge_type: 'tour', emoji: '🥃', category: 'museum', mention_count: 1 },
  { name: '봉래삼선산풍경구', short_desc: null, long_desc: null, country: '중국', region: '연태', badge_type: 'tour', emoji: '⛰️', category: 'nature', mention_count: 1 },
  { name: '적산법화원(장보고기념관)', short_desc: null, long_desc: null, country: '중국', region: '위해', badge_type: 'tour', emoji: '🛕', category: 'temple', mention_count: 1 },
  { name: '해초마을(위해)', short_desc: null, long_desc: null, country: '중국', region: '위해', badge_type: 'tour', emoji: '🏘️', category: 'cultural', mention_count: 1 },
  { name: '도진보(산동)', short_desc: null, long_desc: null, country: '중국', region: '위해', badge_type: 'tour', emoji: '🌊', category: 'nature', mention_count: 1 },
  // Activity
  { name: '적산법화원전동카트', short_desc: null, long_desc: null, country: '중국', region: '위해', badge_type: 'activity', emoji: '🛺', category: 'activity', mention_count: 1 },
  // Special
  { name: '화샤청쇼(위해)', short_desc: null, long_desc: null, country: '중국', region: '위해', badge_type: 'special', emoji: '🎭', category: 'entertainment', mention_count: 1 },
  // Meal
  { name: '발+전신마사지(산동)', short_desc: null, long_desc: null, country: '중국', region: '산동', badge_type: 'meal', emoji: '💆', category: 'wellness', price_info: '$50', mention_count: 1 },
];

// ============================================================
// YANTAI (연태) - 1 product
// ============================================================
const yantai = [
  // Tour
  { name: '연태산공원', short_desc: null, long_desc: null, country: '중국', region: '연태', badge_type: 'tour', emoji: '🏞️', category: 'park', mention_count: 1 },
  { name: '조양가거리', short_desc: null, long_desc: null, country: '중국', region: '연태', badge_type: 'tour', emoji: '🏘️', category: 'cultural', mention_count: 1 },
  { name: '골든비치해변', short_desc: null, long_desc: null, country: '중국', region: '연태', badge_type: 'tour', emoji: '🏖️', category: 'nature', mention_count: 1 },
  { name: '봉래각공원', short_desc: null, long_desc: null, country: '중국', region: '연태', badge_type: 'tour', emoji: '🏛️', category: 'sightseeing', mention_count: 1 },
  { name: '남산대불', short_desc: null, long_desc: null, country: '중국', region: '연태', badge_type: 'tour', emoji: '🛕', category: 'temple', mention_count: 1 },
  // Hotel
  { name: '연태골든비치쉐라톤호텔', short_desc: null, long_desc: null, country: '중국', region: '연태', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '연태골드코스트호텔', short_desc: null, long_desc: null, country: '중국', region: '연태', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
];

// ============================================================
// INNER MONGOLIA (내몽골) - 1 product
// ============================================================
const innerMongolia = [
  // Tour
  { name: '징기스칸릉', short_desc: null, long_desc: null, country: '중국', region: '내몽골', badge_type: 'tour', emoji: '🏛️', category: 'cultural', mention_count: 1 },
  { name: '인컨타라사막', short_desc: null, long_desc: null, country: '중국', region: '내몽골', badge_type: 'tour', emoji: '🏜️', category: 'nature', mention_count: 1 },
  { name: '오르도스대초원', short_desc: null, long_desc: null, country: '중국', region: '내몽골', badge_type: 'tour', emoji: '🌿', category: 'nature', mention_count: 1 },
  { name: '오르도스박물관', short_desc: null, long_desc: null, country: '중국', region: '내몽골', badge_type: 'tour', emoji: '🏛️', category: 'museum', mention_count: 1 },
  // Activity
  { name: '모래썰매', short_desc: null, long_desc: null, country: '중국', region: '내몽골', badge_type: 'activity', emoji: '🛷', category: 'activity', mention_count: 1 },
  { name: '초원꼬마열차', short_desc: null, long_desc: null, country: '중국', region: '내몽골', badge_type: 'activity', emoji: '🚂', category: 'activity', mention_count: 1 },
  { name: '인컨타라사막캠프파이어', short_desc: null, long_desc: null, country: '중국', region: '내몽골', badge_type: 'activity', emoji: '🔥', category: 'activity', mention_count: 1 },
  { name: '오르도스대초원캠프파이어', short_desc: null, long_desc: null, country: '중국', region: '내몽골', badge_type: 'activity', emoji: '🔥', category: 'activity', mention_count: 1 },
  // Optional
  { name: '사막낙타체험', short_desc: null, long_desc: null, country: '중국', region: '내몽골', badge_type: 'optional', emoji: '🐫', category: 'activity', price_info: '$50', mention_count: 1 },
  { name: '사막모터자동차', short_desc: null, long_desc: null, country: '중국', region: '내몽골', badge_type: 'optional', emoji: '🏎️', category: 'activity', price_info: '$100', mention_count: 1 },
  { name: '사막오프로드바이크', short_desc: null, long_desc: null, country: '중국', region: '내몽골', badge_type: 'optional', emoji: '🏍️', category: 'activity', price_info: '$50', mention_count: 1 },
  { name: '초원승마체험(내몽골)', short_desc: null, long_desc: null, country: '중국', region: '내몽골', badge_type: 'optional', emoji: '🐴', category: 'activity', price_info: '$50', mention_count: 1 },
  { name: '대초원마상쇼', short_desc: null, long_desc: null, country: '중국', region: '내몽골', badge_type: 'optional', emoji: '🎪', category: 'entertainment', price_info: '$60', mention_count: 1 },
  // Hotel
  { name: '윈이리버티호텔', short_desc: null, long_desc: null, country: '중국', region: '내몽골', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '크리스탈오르도스리조트(사막유리호텔)', short_desc: null, long_desc: null, country: '중국', region: '내몽골', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '대초원현대식게르', short_desc: null, long_desc: null, country: '중국', region: '내몽골', badge_type: 'hotel', emoji: '⛺', category: 'hotel', mention_count: 1 },
];

// ============================================================
// BEIJING (북경) - 1 product
// ============================================================
const beijing = [
  // Tour
  { name: '천안문광장', short_desc: null, long_desc: null, country: '중국', region: '북경', badge_type: 'tour', emoji: '🏛️', category: 'sightseeing', mention_count: 1 },
  { name: '경산공원(자금성조망)', short_desc: null, long_desc: null, country: '중국', region: '북경', badge_type: 'tour', emoji: '🏞️', category: 'park', mention_count: 1 },
  { name: '십찰해(스차하이)', short_desc: null, long_desc: null, country: '중국', region: '북경', badge_type: 'tour', emoji: '🌊', category: 'cultural', mention_count: 1 },
  { name: '고북수진', short_desc: null, long_desc: null, country: '중국', region: '북경', badge_type: 'tour', emoji: '🏘️', category: 'cultural', mention_count: 1 },
  { name: '사마대장성(만리장성)', short_desc: null, long_desc: null, country: '중국', region: '북경', badge_type: 'tour', emoji: '🏰', category: 'sightseeing', mention_count: 1 },
  { name: '고북수진야경', short_desc: null, long_desc: null, country: '중국', region: '북경', badge_type: 'tour', emoji: '🌃', category: 'cultural', mention_count: 1 },
  { name: '이화원', short_desc: null, long_desc: null, country: '중국', region: '북경', badge_type: 'tour', emoji: '🏛️', category: 'palace', mention_count: 1 },
  { name: '난뤄구샹', short_desc: null, long_desc: null, country: '중국', region: '북경', badge_type: 'tour', emoji: '🏘️', category: 'cultural', mention_count: 1 },
  { name: '전문대가', short_desc: null, long_desc: null, country: '중국', region: '북경', badge_type: 'tour', emoji: '🏛️', category: 'cultural', mention_count: 1 },
  { name: '세무천계(북경)', short_desc: null, long_desc: null, country: '중국', region: '북경', badge_type: 'tour', emoji: '📺', category: 'entertainment', mention_count: 1 },
  { name: '798예술구(북경)', short_desc: null, long_desc: null, country: '중국', region: '북경', badge_type: 'tour', emoji: '🎨', category: 'cultural', mention_count: 1 },
  // Activity
  { name: '사마대장성케이블카', short_desc: null, long_desc: null, country: '중국', region: '북경', badge_type: 'activity', emoji: '🚡', category: 'activity', mention_count: 1 },
  // Special
  { name: '북경서커스', short_desc: null, long_desc: null, country: '중국', region: '북경', badge_type: 'special', emoji: '🎪', category: 'entertainment', mention_count: 1 },
  // Optional
  { name: '금면왕조쇼', short_desc: null, long_desc: null, country: '중국', region: '북경', badge_type: 'optional', emoji: '🎭', category: 'entertainment', price_info: '$60', mention_count: 1 },
  { name: '십찰해인력거투어', short_desc: null, long_desc: null, country: '중국', region: '북경', badge_type: 'optional', emoji: '🛺', category: 'cultural', price_info: '$30', mention_count: 1 },
  { name: '발마사지(북경)', short_desc: null, long_desc: null, country: '중국', region: '북경', badge_type: 'optional', emoji: '💆', category: 'wellness', price_info: '$30', mention_count: 1 },
  // Meal
  { name: '북경오리구이', short_desc: null, long_desc: null, country: '중국', region: '북경', badge_type: 'meal', emoji: '🦆', category: 'meal', mention_count: 1 },
  { name: '샤브샤브(북경)', short_desc: null, long_desc: null, country: '중국', region: '북경', badge_type: 'meal', emoji: '🍲', category: 'meal', mention_count: 1 },
  // Hotel
  { name: '북경개성흥봉호텔', short_desc: null, long_desc: null, country: '중국', region: '북경', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
];

// ============================================================
// BAEKDUSAN (백두산) - 1 product
// ============================================================
const baekdusan = [
  // Tour
  { name: '백두산서파', short_desc: null, long_desc: null, country: '중국', region: '백두산', badge_type: 'tour', emoji: '🏔️', category: 'nature', mention_count: 1 },
  { name: '백두산북파', short_desc: null, long_desc: null, country: '중국', region: '백두산', badge_type: 'tour', emoji: '🏔️', category: 'nature', mention_count: 1 },
  { name: '천지', short_desc: null, long_desc: null, country: '중국', region: '백두산', badge_type: 'tour', emoji: '💧', category: 'nature', mention_count: 1 },
  { name: '37호경계비', short_desc: null, long_desc: null, country: '중국', region: '백두산', badge_type: 'tour', emoji: '🪧', category: 'sightseeing', mention_count: 1 },
  { name: '금강대협곡', short_desc: null, long_desc: null, country: '중국', region: '백두산', badge_type: 'tour', emoji: '🏞️', category: 'nature', mention_count: 1 },
  { name: '장백폭포', short_desc: null, long_desc: null, country: '중국', region: '백두산', badge_type: 'tour', emoji: '💦', category: 'nature', mention_count: 1 },
  { name: '노천온천지대', short_desc: null, long_desc: null, country: '중국', region: '백두산', badge_type: 'tour', emoji: '♨️', category: 'nature', mention_count: 1 },
  { name: '해란강', short_desc: null, long_desc: null, country: '중국', region: '연변', badge_type: 'tour', emoji: '🌊', category: 'nature', mention_count: 1 },
  { name: '일송정', short_desc: null, long_desc: null, country: '중국', region: '연변', badge_type: 'tour', emoji: '🌲', category: 'cultural', mention_count: 1 },
  { name: '진달래광장', short_desc: null, long_desc: null, country: '중국', region: '연변', badge_type: 'tour', emoji: '🌸', category: 'park', mention_count: 1 },
  { name: '중조국경지대', short_desc: null, long_desc: null, country: '중국', region: '연변', badge_type: 'tour', emoji: '🪧', category: 'sightseeing', mention_count: 1 },
  { name: '두만강', short_desc: null, long_desc: null, country: '중국', region: '연변', badge_type: 'tour', emoji: '🌊', category: 'nature', mention_count: 1 },
  { name: '두만강강변공원', short_desc: null, long_desc: null, country: '중국', region: '연변', badge_type: 'tour', emoji: '🏞️', category: 'park', mention_count: 1 },
  // Hotel
  { name: '이도백하금수학호텔', short_desc: null, long_desc: null, country: '중국', region: '백두산', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '연변국제호텔', short_desc: null, long_desc: null, country: '중국', region: '연변', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  // Meal
  { name: '연길냉면+궈바로우특식', short_desc: null, long_desc: null, country: '중국', region: '연변', badge_type: 'meal', emoji: '🍜', category: 'meal', mention_count: 1 },
];

// ============================================================
// HONG KONG + SHENZHEN + MACAU (홍콩+심천+마카오) - 1 product
// ============================================================
const hongkongShenzhenMacau = [
  // Tour
  { name: '헐리우드로드', short_desc: null, long_desc: null, country: '홍콩', region: '홍콩', badge_type: 'tour', emoji: '🏛️', category: 'cultural', mention_count: 1 },
  { name: '미드레벨에스컬레이터', short_desc: null, long_desc: null, country: '홍콩', region: '홍콩', badge_type: 'tour', emoji: '🏙️', category: 'sightseeing', mention_count: 1 },
  { name: '소호거리', short_desc: null, long_desc: null, country: '홍콩', region: '홍콩', badge_type: 'tour', emoji: '🍽️', category: 'cultural', mention_count: 1 },
  { name: '타이쿤', short_desc: null, long_desc: null, country: '홍콩', region: '홍콩', badge_type: 'tour', emoji: '🎨', category: 'cultural', mention_count: 1 },
  { name: '빅토리아피크', short_desc: null, long_desc: null, country: '홍콩', region: '홍콩', badge_type: 'tour', emoji: '🌃', category: 'sightseeing', mention_count: 1 },
  { name: '웡타이신사원', short_desc: null, long_desc: null, country: '홍콩', region: '홍콩', badge_type: 'tour', emoji: '🛕', category: 'temple', mention_count: 1 },
  { name: '금수중화민속촌', short_desc: null, long_desc: null, country: '중국', region: '심천', badge_type: 'tour', emoji: '🏰', category: 'entertainment', mention_count: 1 },
  { name: '소인국테마파크', short_desc: null, long_desc: null, country: '중국', region: '심천', badge_type: 'tour', emoji: '🎢', category: 'entertainment', mention_count: 1 },
  { name: '민속쇼(심천)', short_desc: null, long_desc: null, country: '중국', region: '심천', badge_type: 'tour', emoji: '🎭', category: 'entertainment', mention_count: 1 },
  { name: '세나도광장', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'tour', emoji: '🏛️', category: 'sightseeing', mention_count: 1 },
  { name: '성바울성당유적', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'tour', emoji: '⛪', category: 'cultural', mention_count: 1 },
  { name: '몬테요새', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'tour', emoji: '🏰', category: 'sightseeing', mention_count: 1 },
  { name: '성도미니크성당', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'tour', emoji: '⛪', category: 'cultural', mention_count: 1 },
  { name: '육포및쿠키거리', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'tour', emoji: '🍪', category: 'shopping', mention_count: 1 },
  // Activity
  { name: '빅토리아피크트램(편도)', short_desc: null, long_desc: null, country: '홍콩', region: '홍콩', badge_type: 'activity', emoji: '🚋', category: 'activity', mention_count: 1 },
  // Optional
  { name: '홍콩마담투소', short_desc: null, long_desc: null, country: '홍콩', region: '홍콩', badge_type: 'optional', emoji: '🎭', category: 'entertainment', price_info: '$30', mention_count: 1 },
  { name: '홍콩나이트시티투어', short_desc: null, long_desc: null, country: '홍콩', region: '홍콩', badge_type: 'optional', emoji: '🌃', category: 'entertainment', price_info: '$30', mention_count: 1 },
  { name: '심천코끼리열차', short_desc: null, long_desc: null, country: '중국', region: '심천', badge_type: 'optional', emoji: '🚂', category: 'activity', price_info: '$7', mention_count: 1 },
  { name: '심천발마사지', short_desc: null, long_desc: null, country: '중국', region: '심천', badge_type: 'optional', emoji: '💆', category: 'wellness', price_info: '$30', mention_count: 1 },
  { name: '마카오BIG3', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'optional', emoji: '🎫', category: 'entertainment', price_info: '$45', mention_count: 1 },
  // Meal
  { name: '광동식', short_desc: null, long_desc: null, country: '홍콩', region: '홍콩', badge_type: 'meal', emoji: '🥘', category: 'meal', mention_count: 1 },
  { name: '얌차식(딤섬)', short_desc: null, long_desc: null, country: '홍콩', region: '홍콩', badge_type: 'meal', emoji: '🥟', category: 'meal', mention_count: 1 },
  { name: '에그타르트(1인1개)', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'meal', emoji: '🥧', category: 'meal', mention_count: 1 },
  { name: '매캐니즈식', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'meal', emoji: '🍽️', category: 'meal', mention_count: 1 },
  // Hotel
  { name: '코지오아시스호텔(홍콩)', short_desc: null, long_desc: null, country: '홍콩', region: '홍콩', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '심천햄튼바이힐튼', short_desc: null, long_desc: null, country: '중국', region: '심천', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '카사리얼(마카오)', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
];

// ============================================================
// PREMIUM MACAU (프리미엄 마카오) - 1 product
// ============================================================
const premiumMacau = [
  // Tour
  { name: '콜로안빌리지', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'tour', emoji: '🏘️', category: 'cultural', mention_count: 1 },
  { name: '성프란체스코자비에르성당', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'tour', emoji: '⛪', category: 'cultural', mention_count: 1 },
  { name: '타이파빌리지', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'tour', emoji: '🏘️', category: 'cultural', mention_count: 1 },
  { name: '타이파주택박물관', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'tour', emoji: '🏛️', category: 'museum', mention_count: 1 },
  { name: '카르멜성모성당', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'tour', emoji: '⛪', category: 'cultural', mention_count: 1 },
  { name: '쿤하거리', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'tour', emoji: '🍽️', category: 'cultural', mention_count: 1 },
  { name: '마카오타워', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'tour', emoji: '🗼', category: 'sightseeing', mention_count: 1 },
  { name: '베네시안호텔투어', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'tour', emoji: '🏨', category: 'entertainment', mention_count: 1 },
  { name: '윈팰리스호텔분수쇼', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'tour', emoji: '⛲', category: 'entertainment', mention_count: 1 },
  { name: '런더너마카오', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'tour', emoji: '🏨', category: 'entertainment', mention_count: 1 },
  { name: '피셔맨스워프마카오', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'tour', emoji: '🎢', category: 'entertainment', mention_count: 1 },
  { name: '마카오MGM실내정원', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'tour', emoji: '🌴', category: 'entertainment', mention_count: 1 },
  // Activity
  { name: '마카오오픈탑2층버스나이트투어', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'activity', emoji: '🚌', category: 'activity', mention_count: 1 },
  // Restaurant
  { name: '마카오타워360도레스토랑뷔페', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'restaurant', emoji: '🍽️', category: 'meal', mention_count: 1 },
  // Hotel
  { name: '크라운플라자호텔(마카오)', short_desc: null, long_desc: null, country: '마카오', region: '마카오', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
];

// ============================================================
// MONGOLIA (몽골) - 1 product
// ============================================================
const mongolia = [
  // Tour
  { name: '어워(돌무지)', short_desc: null, long_desc: null, country: '몽골', region: '울란바토르', badge_type: 'tour', emoji: '🪨', category: 'cultural', mention_count: 1 },
  { name: '거북바위', short_desc: null, long_desc: null, country: '몽골', region: '테를지', badge_type: 'tour', emoji: '🪨', category: 'nature', mention_count: 1 },
  { name: '유목민마을', short_desc: null, long_desc: null, country: '몽골', region: '테를지', badge_type: 'tour', emoji: '⛺', category: 'cultural', mention_count: 1 },
  { name: '톨강', short_desc: null, long_desc: null, country: '몽골', region: '울란바토르', badge_type: 'tour', emoji: '🌊', category: 'nature', mention_count: 1 },
  { name: '야리야발사원', short_desc: null, long_desc: null, country: '몽골', region: '테를지', badge_type: 'tour', emoji: '🛕', category: 'temple', mention_count: 1 },
  { name: '징기스칸마동상', short_desc: null, long_desc: null, country: '몽골', region: '울란바토르', badge_type: 'tour', emoji: '🗽', category: 'sightseeing', mention_count: 1 },
  // Activity
  { name: '몽골푸르공체험', short_desc: null, long_desc: null, country: '몽골', region: '테를지', badge_type: 'activity', emoji: '🎯', category: 'activity', mention_count: 1 },
  { name: '테를지올레길트레킹', short_desc: null, long_desc: null, country: '몽골', region: '테를지', badge_type: 'activity', emoji: '🥾', category: 'activity', mention_count: 1 },
  { name: '몽골연날리기', short_desc: null, long_desc: null, country: '몽골', region: '테를지', badge_type: 'activity', emoji: '🪁', category: 'activity', mention_count: 1 },
  { name: '테를지독수리체험', short_desc: null, long_desc: null, country: '몽골', region: '테를지', badge_type: 'activity', emoji: '🦅', category: 'activity', mention_count: 1 },
  // Special
  { name: '테를지별빛포차', short_desc: null, long_desc: null, country: '몽골', region: '테를지', badge_type: 'special', emoji: '🌟', category: 'entertainment', mention_count: 1 },
  { name: '몽골별빛프로그램', short_desc: null, long_desc: null, country: '몽골', region: '테를지', badge_type: 'special', emoji: '✨', category: 'entertainment', mention_count: 1 },
  // Optional
  { name: '테를지승마체험', short_desc: null, long_desc: null, country: '몽골', region: '테를지', badge_type: 'optional', emoji: '🐴', category: 'activity', price_info: '$30', mention_count: 1 },
  { name: '마동상내부관람', short_desc: null, long_desc: null, country: '몽골', region: '울란바토르', badge_type: 'optional', emoji: '🏛️', category: 'sightseeing', price_info: '$20', mention_count: 1 },
  { name: '몽골전통공연', short_desc: null, long_desc: null, country: '몽골', region: '울란바토르', badge_type: 'optional', emoji: '🎵', category: 'entertainment', price_info: '$30', mention_count: 1 },
  { name: '몽골마사지', short_desc: null, long_desc: null, country: '몽골', region: '울란바토르', badge_type: 'optional', emoji: '💆', category: 'wellness', price_info: '$30', mention_count: 1 },
  // Meal
  { name: '허르헉(몽골전통요리)', short_desc: null, long_desc: null, country: '몽골', region: '울란바토르', badge_type: 'meal', emoji: '🍖', category: 'meal', mention_count: 1 },
  // Hotel
  { name: '울란바토르4성급호텔', short_desc: null, long_desc: null, country: '몽골', region: '울란바토르', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '테를지신게르(게르캠프)', short_desc: null, long_desc: null, country: '몽골', region: '테를지', badge_type: 'hotel', emoji: '⛺', category: 'hotel', mention_count: 1 },
];

// ============================================================
// MAIN: Upsert all attractions
// ============================================================
async function main() {
  const allAttractions = [
    ...zhangjiajie,
    ...qingdao,
    ...shandong,
    ...yantai,
    ...innerMongolia,
    ...beijing,
    ...baekdusan,
    ...hongkongShenzhenMacau,
    ...premiumMacau,
    ...mongolia,
  ];

  console.log(`Total attractions to upsert: ${allAttractions.length}`);
  console.log('---');
  console.log(`  Zhangjiajie: ${zhangjiajie.length}`);
  console.log(`  Qingdao: ${qingdao.length}`);
  console.log(`  Shandong Peninsula: ${shandong.length}`);
  console.log(`  Yantai: ${yantai.length}`);
  console.log(`  Inner Mongolia: ${innerMongolia.length}`);
  console.log(`  Beijing: ${beijing.length}`);
  console.log(`  Baekdusan: ${baekdusan.length}`);
  console.log(`  HK+Shenzhen+Macau: ${hongkongShenzhenMacau.length}`);
  console.log(`  Premium Macau: ${premiumMacau.length}`);
  console.log(`  Mongolia: ${mongolia.length}`);
  console.log('---');

  // Upsert in batches of 50
  const BATCH = 50;
  let totalUpserted = 0;

  for (let i = 0; i < allAttractions.length; i += BATCH) {
    const batch = allAttractions.slice(i, i + BATCH);
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
