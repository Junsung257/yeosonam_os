// Usage: node db/upsert_modetour_japan.js
// Upserts Japanese attractions from 18 Modetour Japan products into Supabase

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const attractions = [
  // ============================================================
  // TOKYO / HAKONE (2 products)
  // ============================================================
  // Tour
  { name: '다이바시티프라자', short_desc: null, long_desc: null, country: '일본', region: '도쿄', badge_type: 'tour', emoji: '🛍️', category: 'shopping', mention_count: 2 },
  { name: '오다이바해변공원', short_desc: null, long_desc: null, country: '일본', region: '도쿄', badge_type: 'tour', emoji: '🏖️', category: 'park', mention_count: 2 },
  { name: '후지산', short_desc: null, long_desc: null, country: '일본', region: '하코네', badge_type: 'tour', emoji: '🗻', category: 'nature', mention_count: 2 },
  { name: '오시노핫카이', short_desc: null, long_desc: null, country: '일본', region: '하코네', badge_type: 'tour', emoji: '💧', category: 'nature', mention_count: 2 },
  { name: '하코네국립공원', short_desc: null, long_desc: null, country: '일본', region: '하코네', badge_type: 'tour', emoji: '🏞️', category: 'nature', mention_count: 2 },
  { name: '아시호수해적선', short_desc: null, long_desc: null, country: '일본', region: '하코네', badge_type: 'tour', emoji: '🚢', category: 'sightseeing', mention_count: 2 },
  { name: '온시하코네공원', short_desc: null, long_desc: null, country: '일본', region: '하코네', badge_type: 'tour', emoji: '🌳', category: 'park', mention_count: 1 },
  { name: '신주쿠가부키초', short_desc: null, long_desc: null, country: '일본', region: '도쿄', badge_type: 'tour', emoji: '🌃', category: 'sightseeing', mention_count: 1 },
  { name: '아사쿠사관음사', short_desc: null, long_desc: null, country: '일본', region: '도쿄', badge_type: 'tour', emoji: '⛩️', category: 'temple', mention_count: 2 },
  { name: '나카미세거리', short_desc: null, long_desc: null, country: '일본', region: '도쿄', badge_type: 'tour', emoji: '🏮', category: 'shopping', mention_count: 2 },
  { name: '스카이트리', short_desc: null, long_desc: null, country: '일본', region: '도쿄', badge_type: 'tour', emoji: '🗼', category: 'sightseeing', mention_count: 1 },
  { name: '가와고에전통가옥거리', short_desc: null, long_desc: null, country: '일본', region: '사이타마', badge_type: 'tour', emoji: '🏘️', category: 'cultural', mention_count: 1 },
  { name: '다이쇼낭만거리', short_desc: null, long_desc: null, country: '일본', region: '사이타마', badge_type: 'tour', emoji: '🏚️', category: 'cultural', mention_count: 1 },
  { name: '토키노카네', short_desc: null, long_desc: null, country: '일본', region: '사이타마', badge_type: 'tour', emoji: '🕰️', category: 'sightseeing', mention_count: 1 },
  { name: '카시야요코초', short_desc: null, long_desc: null, country: '일본', region: '사이타마', badge_type: 'tour', emoji: '🍬', category: 'shopping', mention_count: 1 },
  { name: '기타구치혼구후지센겐신사', short_desc: null, long_desc: null, country: '일본', region: '야마나시', badge_type: 'tour', emoji: '⛩️', category: 'temple', mention_count: 1 },
  { name: '오이시공원', short_desc: null, long_desc: null, country: '일본', region: '야마나시', badge_type: 'tour', emoji: '🌸', category: 'park', mention_count: 1 },
  { name: '하코네신사', short_desc: null, long_desc: null, country: '일본', region: '하코네', badge_type: 'tour', emoji: '⛩️', category: 'temple', mention_count: 1 },
  // Activity
  { name: '아시호수해적선탑승', short_desc: null, long_desc: null, country: '일본', region: '하코네', badge_type: 'activity', emoji: '🚢', category: 'activity', mention_count: 2 },
  // Onsen
  { name: '도쿄근교온천호텔', short_desc: null, long_desc: null, country: '일본', region: '도쿄', badge_type: 'onsen', emoji: '♨️', category: 'onsen', mention_count: 2 },
  // Hotel
  { name: '토미노코온천호텔', short_desc: null, long_desc: null, country: '일본', region: '하코네', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '빌라폰테뉴그랜드하네다', short_desc: null, long_desc: null, country: '일본', region: '도쿄', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '유카리노모리호텔', short_desc: null, long_desc: null, country: '일본', region: '도쿄', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '아나크라운프라자나리타', short_desc: null, long_desc: null, country: '일본', region: '치바', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  // Meal
  { name: '호텔뷔페식', short_desc: null, long_desc: null, country: '일본', region: '도쿄', badge_type: 'meal', emoji: '🍽️', category: 'meal', mention_count: 2 },
  { name: '샤브샤브무제한', short_desc: null, long_desc: null, country: '일본', region: '도쿄', badge_type: 'meal', emoji: '🥘', category: 'meal', mention_count: 2 },
  { name: '덴푸라+우동정식', short_desc: null, long_desc: null, country: '일본', region: '도쿄', badge_type: 'meal', emoji: '🍜', category: 'meal', mention_count: 1 },

  // ============================================================
  // KANSAI (2 products: 고베/오사카/교토/나라 + 나고야/간사이)
  // ============================================================
  // Tour
  { name: '청수사', short_desc: null, long_desc: null, country: '일본', region: '교토', badge_type: 'tour', emoji: '⛩️', category: 'temple', mention_count: 2 },
  { name: '니넨자카', short_desc: null, long_desc: null, country: '일본', region: '교토', badge_type: 'tour', emoji: '🏘️', category: 'cultural', mention_count: 2 },
  { name: '산넨자카', short_desc: null, long_desc: null, country: '일본', region: '교토', badge_type: 'tour', emoji: '🏘️', category: 'cultural', mention_count: 2 },
  { name: '와카쿠사야마전망대', short_desc: null, long_desc: null, country: '일본', region: '나라', badge_type: 'tour', emoji: '🏔️', category: 'nature', mention_count: 1 },
  { name: '가스가타이샤', short_desc: null, long_desc: null, country: '일본', region: '나라', badge_type: 'tour', emoji: '⛩️', category: 'temple', mention_count: 1 },
  { name: '나라코엔', short_desc: null, long_desc: null, country: '일본', region: '나라', badge_type: 'tour', emoji: '🦌', category: 'park', mention_count: 2 },
  { name: '오사카성', short_desc: null, long_desc: null, country: '일본', region: '오사카', badge_type: 'tour', emoji: '🏯', category: 'palace', mention_count: 2 },
  { name: '신사이바시-도톤보리', short_desc: null, long_desc: null, country: '일본', region: '오사카', badge_type: 'tour', emoji: '🌃', category: 'shopping', mention_count: 2 },
  { name: '하버랜드-모자이크', short_desc: null, long_desc: null, country: '일본', region: '고베', badge_type: 'tour', emoji: '🌉', category: 'shopping', mention_count: 1 },
  { name: '히메지성', short_desc: null, long_desc: null, country: '일본', region: '효고', badge_type: 'tour', emoji: '🏯', category: 'palace', mention_count: 1 },
  { name: '코코엔', short_desc: null, long_desc: null, country: '일본', region: '효고', badge_type: 'tour', emoji: '🌳', category: 'park', mention_count: 1 },
  { name: '롯코산', short_desc: null, long_desc: null, country: '일본', region: '고베', badge_type: 'tour', emoji: '🏔️', category: 'nature', mention_count: 1 },
  { name: '아라시야마/토게쯔교/치쿠린대숲', short_desc: null, long_desc: null, country: '일본', region: '교토', badge_type: 'tour', emoji: '🎋', category: 'nature', mention_count: 2 },
  { name: '노노미야신사', short_desc: null, long_desc: null, country: '일본', region: '교토', badge_type: 'tour', emoji: '⛩️', category: 'temple', mention_count: 1 },
  { name: '폰토쵸', short_desc: null, long_desc: null, country: '일본', region: '교토', badge_type: 'tour', emoji: '🏮', category: 'cultural', mention_count: 1 },
  { name: '후시미이나리타이샤(야경)', short_desc: null, long_desc: null, country: '일본', region: '교토', badge_type: 'tour', emoji: '⛩️', category: 'temple', mention_count: 1 },
  { name: '도코나메도자기마을', short_desc: null, long_desc: null, country: '일본', region: '나고야', badge_type: 'tour', emoji: '🏺', category: 'cultural', mention_count: 1 },
  { name: '록카엔', short_desc: null, long_desc: null, country: '일본', region: '나고야', badge_type: 'tour', emoji: '🌳', category: 'park', mention_count: 1 },
  { name: '라코리나', short_desc: null, long_desc: null, country: '일본', region: '시가', badge_type: 'tour', emoji: '🌿', category: 'sightseeing', mention_count: 1 },
  { name: '나바나노사토', short_desc: null, long_desc: null, country: '일본', region: '미에', badge_type: 'tour', emoji: '✨', category: 'entertainment', mention_count: 1 },
  { name: '사토노유온천', short_desc: null, long_desc: null, country: '일본', region: '나고야', badge_type: 'tour', emoji: '♨️', category: 'onsen', mention_count: 1 },
  { name: '요시키엔정원', short_desc: null, long_desc: null, country: '일본', region: '나라', badge_type: 'tour', emoji: '🌳', category: 'park', mention_count: 1 },
  { name: '동대사(도다이지)', short_desc: null, long_desc: null, country: '일본', region: '나라', badge_type: 'tour', emoji: '🛕', category: 'temple', mention_count: 1 },
  // Meal
  { name: '유두부정식', short_desc: null, long_desc: null, country: '일본', region: '교토', badge_type: 'meal', emoji: '🍲', category: 'meal', mention_count: 1 },
  { name: '스시우동정식', short_desc: null, long_desc: null, country: '일본', region: '오사카', badge_type: 'meal', emoji: '🍣', category: 'meal', mention_count: 1 },
  { name: '고베명물스테이크', short_desc: null, long_desc: null, country: '일본', region: '고베', badge_type: 'meal', emoji: '🥩', category: 'meal', mention_count: 1 },
  { name: '스키야키정식', short_desc: null, long_desc: null, country: '일본', region: '간사이', badge_type: 'meal', emoji: '🥘', category: 'meal', mention_count: 2 },
  { name: '가마메시솥밥', short_desc: null, long_desc: null, country: '일본', region: '나고야', badge_type: 'meal', emoji: '🍚', category: 'meal', mention_count: 1 },
  { name: '와규미소야키', short_desc: null, long_desc: null, country: '일본', region: '나고야', badge_type: 'meal', emoji: '🥩', category: 'meal', mention_count: 1 },
  // Hotel
  { name: '노보텔나라', short_desc: null, long_desc: null, country: '일본', region: '나라', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '나고야힐튼', short_desc: null, long_desc: null, country: '일본', region: '나고야', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '더블트리바이힐튼교토', short_desc: null, long_desc: null, country: '일본', region: '교토', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },

  // ============================================================
  // KYUSHU (2 products)
  // ============================================================
  // Tour
  { name: '구마모토성', short_desc: null, long_desc: null, country: '일본', region: '구마모토', badge_type: 'tour', emoji: '🏯', category: 'palace', mention_count: 2 },
  { name: '사쿠라노바바(조사이엔)', short_desc: null, long_desc: null, country: '일본', region: '구마모토', badge_type: 'tour', emoji: '🏚️', category: 'cultural', mention_count: 2 },
  { name: '아소대관봉', short_desc: null, long_desc: null, country: '일본', region: '구마모토', badge_type: 'tour', emoji: '🏔️', category: 'nature', mention_count: 1 },
  { name: '쿠사센리', short_desc: null, long_desc: null, country: '일본', region: '구마모토', badge_type: 'tour', emoji: '🌿', category: 'nature', mention_count: 1 },
  { name: '가마도지옥', short_desc: null, long_desc: null, country: '일본', region: '벳부', badge_type: 'tour', emoji: '🌋', category: 'nature', mention_count: 2 },
  { name: '유노하나재배지', short_desc: null, long_desc: null, country: '일본', region: '벳부', badge_type: 'tour', emoji: '♨️', category: 'nature', mention_count: 2 },
  { name: '유후다케', short_desc: null, long_desc: null, country: '일본', region: '유후인', badge_type: 'tour', emoji: '🏔️', category: 'nature', mention_count: 2 },
  { name: '긴린코호수', short_desc: null, long_desc: null, country: '일본', region: '유후인', badge_type: 'tour', emoji: '💧', category: 'nature', mention_count: 2 },
  { name: '유후인상점거리', short_desc: null, long_desc: null, country: '일본', region: '유후인', badge_type: 'tour', emoji: '🏘️', category: 'cultural', mention_count: 2 },
  { name: '나가사키원폭자료관', short_desc: null, long_desc: null, country: '일본', region: '나가사키', badge_type: 'tour', emoji: '🏛️', category: 'museum', mention_count: 1 },
  { name: '하나노마치아케이드', short_desc: null, long_desc: null, country: '일본', region: '나가사키', badge_type: 'tour', emoji: '🛍️', category: 'shopping', mention_count: 1 },
  { name: '오란다자카', short_desc: null, long_desc: null, country: '일본', region: '나가사키', badge_type: 'tour', emoji: '🏘️', category: 'cultural', mention_count: 1 },
  { name: '구라바엔', short_desc: null, long_desc: null, country: '일본', region: '나가사키', badge_type: 'tour', emoji: '🌳', category: 'park', mention_count: 1 },
  { name: '메가네바시', short_desc: null, long_desc: null, country: '일본', region: '나가사키', badge_type: 'tour', emoji: '🌉', category: 'sightseeing', mention_count: 1 },
  { name: '스이젠지코엔', short_desc: null, long_desc: null, country: '일본', region: '구마모토', badge_type: 'tour', emoji: '🌳', category: 'park', mention_count: 1 },
  { name: '다자이후텐만구', short_desc: null, long_desc: null, country: '일본', region: '후쿠오카', badge_type: 'tour', emoji: '⛩️', category: 'temple', mention_count: 2 },
  { name: '야나가와뱃놀이', short_desc: null, long_desc: null, country: '일본', region: '후쿠오카', badge_type: 'tour', emoji: '🛶', category: 'cultural', mention_count: 2 },
  { name: '쿠로가와온천거리', short_desc: null, long_desc: null, country: '일본', region: '구마모토', badge_type: 'tour', emoji: '♨️', category: 'nature', mention_count: 1 },
  { name: '하카타포트타워', short_desc: null, long_desc: null, country: '일본', region: '후쿠오카', badge_type: 'tour', emoji: '🗼', category: 'sightseeing', mention_count: 1 },
  // Activity
  // 야나가와뱃놀이 is already listed as tour above (also activity)
  // Meal
  { name: '카츠나베정식', short_desc: null, long_desc: null, country: '일본', region: '큐슈', badge_type: 'meal', emoji: '🍲', category: 'meal', mention_count: 1 },
  { name: '규스키야키', short_desc: null, long_desc: null, country: '일본', region: '큐슈', badge_type: 'meal', emoji: '🥘', category: 'meal', mention_count: 1 },
  { name: '토반야끼', short_desc: null, long_desc: null, country: '일본', region: '큐슈', badge_type: 'meal', emoji: '🥩', category: 'meal', mention_count: 1 },
  { name: '무제한대게뷔페', short_desc: null, long_desc: null, country: '일본', region: '큐슈', badge_type: 'meal', emoji: '🦀', category: 'meal', mention_count: 1 },
  { name: '와규카레', short_desc: null, long_desc: null, country: '일본', region: '큐슈', badge_type: 'meal', emoji: '🍛', category: 'meal', mention_count: 1 },
  // Hotel
  { name: '호텔세키아리조트&스파', short_desc: null, long_desc: null, country: '일본', region: '구마모토', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '그랜드머큐어벳부베이', short_desc: null, long_desc: null, country: '일본', region: '벳부', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '나가사키일승관호텔', short_desc: null, long_desc: null, country: '일본', region: '나가사키', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '츠에타테온센히젠야', short_desc: null, long_desc: null, country: '일본', region: '구마모토', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  // Onsen
  { name: '가마도지옥족욕체험', short_desc: null, long_desc: null, country: '일본', region: '벳부', badge_type: 'onsen', emoji: '♨️', category: 'onsen', mention_count: 2 },

  // ============================================================
  // HOKKAIDO (2 products)
  // ============================================================
  // Tour
  { name: '시코츠호수', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'tour', emoji: '💧', category: 'nature', mention_count: 2 },
  { name: '오타루운하', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'tour', emoji: '🌉', category: 'sightseeing', mention_count: 2 },
  { name: '오타루오르골당', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'tour', emoji: '🎵', category: 'museum', mention_count: 2 },
  { name: '유리공방과과자거리', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'tour', emoji: '🍫', category: 'shopping', mention_count: 2 },
  { name: '삿포로맥주박물관', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'tour', emoji: '🍺', category: 'museum', mention_count: 1 },
  { name: '시로이코이비토파크', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'tour', emoji: '🍫', category: 'entertainment', mention_count: 1 },
  { name: '오도리공원', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'tour', emoji: '🌳', category: 'park', mention_count: 2 },
  { name: '스스키노거리', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'tour', emoji: '🌃', category: 'sightseeing', mention_count: 2 },
  { name: '삿포로시계탑', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'tour', emoji: '🕰️', category: 'sightseeing', mention_count: 1 },
  { name: '비에이패치워크로드', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'tour', emoji: '🌾', category: 'nature', mention_count: 2 },
  { name: '사계절의언덕', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'tour', emoji: '🌸', category: 'nature', mention_count: 2 },
  { name: '비에이푸른연못(청의호수)', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'tour', emoji: '💎', category: 'nature', mention_count: 2 },
  { name: '흰수염폭포', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'tour', emoji: '🌊', category: 'nature', mention_count: 1 },
  { name: '팜도미타', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'tour', emoji: '💐', category: 'nature', mention_count: 1 },
  { name: '오토코야마사케양조장', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'tour', emoji: '🍶', category: 'museum', mention_count: 1 },
  { name: '도야호수유람선', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'tour', emoji: '🚢', category: 'sightseeing', mention_count: 1 },
  { name: '쇼와신잔', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'tour', emoji: '🌋', category: 'nature', mention_count: 1 },
  { name: '사이로전망대', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'tour', emoji: '🏔️', category: 'nature', mention_count: 1 },
  { name: '지옥계곡(노보리베츠)', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'tour', emoji: '🌋', category: 'nature', mention_count: 1 },
  { name: '지다이무라(시대촌)', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'tour', emoji: '🏯', category: 'entertainment', mention_count: 1 },
  { name: '삿포로구도청사', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'tour', emoji: '🏛️', category: 'sightseeing', mention_count: 1 },
  // Activity
  { name: '도야호수유람선탑승', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'activity', emoji: '🚢', category: 'activity', mention_count: 1 },
  { name: '사계절의언덕트랙터탑승', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'activity', emoji: '🚜', category: 'activity', mention_count: 1 },
  // Meal
  { name: '홋케(임연수)정식', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'meal', emoji: '🐟', category: 'meal', mention_count: 1 },
  { name: '무제한대게+전골특식', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'meal', emoji: '🦀', category: 'meal', mention_count: 1 },
  { name: '소바+덴푸라정식', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'meal', emoji: '🍜', category: 'meal', mention_count: 1 },
  // Hotel
  { name: '아트호텔아사히카와', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '트래블롯지삿포로스스키노', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '죠잔케이시카노유호텔', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '도야썬팰리스리조트', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '삿포로뉴오타니인', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  // Onsen
  { name: '죠잔케이온천', short_desc: null, long_desc: null, country: '일본', region: '홋카이도', badge_type: 'onsen', emoji: '♨️', category: 'onsen', mention_count: 2 },

  // ============================================================
  // NAGOYA / CHUBU (2 products: 알펜루트 + 나고야/간사이)
  // ============================================================
  // Tour
  { name: '마고메쥬쿠', short_desc: null, long_desc: null, country: '일본', region: '나가노', badge_type: 'tour', emoji: '🏘️', category: 'cultural', mention_count: 1 },
  { name: '구로베댐', short_desc: null, long_desc: null, country: '일본', region: '도야마', badge_type: 'tour', emoji: '🏗️', category: 'sightseeing', mention_count: 1 },
  { name: '구로베다이라', short_desc: null, long_desc: null, country: '일본', region: '도야마', badge_type: 'tour', emoji: '🏔️', category: 'nature', mention_count: 1 },
  { name: '다이칸보', short_desc: null, long_desc: null, country: '일본', region: '도야마', badge_type: 'tour', emoji: '🏔️', category: 'nature', mention_count: 1 },
  { name: '무로도(설벽체험)', short_desc: null, long_desc: null, country: '일본', region: '도야마', badge_type: 'tour', emoji: '❄️', category: 'nature', mention_count: 1 },
  { name: '고카야마역사마을', short_desc: null, long_desc: null, country: '일본', region: '도야마', badge_type: 'tour', emoji: '🏘️', category: 'cultural', mention_count: 1 },
  { name: '겐로쿠엔', short_desc: null, long_desc: null, country: '일본', region: '이시카와', badge_type: 'tour', emoji: '🌳', category: 'park', mention_count: 1 },
  { name: '히가시차야거리', short_desc: null, long_desc: null, country: '일본', region: '이시카와', badge_type: 'tour', emoji: '🏮', category: 'cultural', mention_count: 1 },
  { name: '도진보', short_desc: null, long_desc: null, country: '일본', region: '후쿠이', badge_type: 'tour', emoji: '🌊', category: 'nature', mention_count: 1 },
  { name: '나고야성', short_desc: null, long_desc: null, country: '일본', region: '나고야', badge_type: 'tour', emoji: '🏯', category: 'palace', mention_count: 1 },
  { name: '사카에거리', short_desc: null, long_desc: null, country: '일본', region: '나고야', badge_type: 'tour', emoji: '🌃', category: 'shopping', mention_count: 1 },
  // Activity
  { name: '알펜루트횡단', short_desc: null, long_desc: null, country: '일본', region: '도야마', badge_type: 'activity', emoji: '🚡', category: 'activity', mention_count: 1 },
  { name: '설벽체험', short_desc: null, long_desc: null, country: '일본', region: '도야마', badge_type: 'activity', emoji: '❄️', category: 'activity', mention_count: 1 },
  // Meal
  { name: '야키니쿠무제한', short_desc: null, long_desc: null, country: '일본', region: '주부', badge_type: 'meal', emoji: '🥩', category: 'meal', mention_count: 2 },
  // Hotel
  { name: '오오에도모노가타리에나쿄', short_desc: null, long_desc: null, country: '일본', region: '기후', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '머큐어도야마토나미', short_desc: null, long_desc: null, country: '일본', region: '도야마', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '코트야드바이메리어트후쿠이', short_desc: null, long_desc: null, country: '일본', region: '후쿠이', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },

  // ============================================================
  // OKINAWA (2 products)
  // ============================================================
  // Tour
  { name: '아메리칸빌리지', short_desc: null, long_desc: null, country: '일본', region: '오키나와', badge_type: 'tour', emoji: '🏘️', category: 'shopping', mention_count: 2 },
  { name: '만좌모', short_desc: null, long_desc: null, country: '일본', region: '오키나와', badge_type: 'tour', emoji: '🌊', category: 'nature', mention_count: 2 },
  { name: '츄라우미수족관', short_desc: null, long_desc: null, country: '일본', region: '오키나와', badge_type: 'tour', emoji: '🐋', category: 'entertainment', mention_count: 2 },
  { name: '돌고래쇼', short_desc: null, long_desc: null, country: '일본', region: '오키나와', badge_type: 'tour', emoji: '🐬', category: 'entertainment', mention_count: 2 },
  { name: '코우리대교', short_desc: null, long_desc: null, country: '일본', region: '오키나와', badge_type: 'tour', emoji: '🌉', category: 'sightseeing', mention_count: 2 },
  { name: '국제거리', short_desc: null, long_desc: null, country: '일본', region: '오키나와', badge_type: 'tour', emoji: '🛍️', category: 'shopping', mention_count: 2 },
  { name: '슈리성', short_desc: null, long_desc: null, country: '일본', region: '오키나와', badge_type: 'tour', emoji: '🏯', category: 'palace', mention_count: 2 },
  { name: '우미카지테라스', short_desc: null, long_desc: null, country: '일본', region: '오키나와', badge_type: 'tour', emoji: '☀️', category: 'shopping', mention_count: 1 },
  { name: '오키나와월드', short_desc: null, long_desc: null, country: '일본', region: '오키나와', badge_type: 'tour', emoji: '🌺', category: 'entertainment', mention_count: 1 },
  { name: '옥천동굴', short_desc: null, long_desc: null, country: '일본', region: '오키나와', badge_type: 'tour', emoji: '🕳️', category: 'nature', mention_count: 1 },
  { name: '치넨미사키공원', short_desc: null, long_desc: null, country: '일본', region: '오키나와', badge_type: 'tour', emoji: '🌊', category: 'park', mention_count: 1 },
  { name: '에이사민속공연', short_desc: null, long_desc: null, country: '일본', region: '오키나와', badge_type: 'tour', emoji: '💃', category: 'entertainment', mention_count: 1 },
  { name: '니라이카나이대교', short_desc: null, long_desc: null, country: '일본', region: '오키나와', badge_type: 'tour', emoji: '🌉', category: 'sightseeing', mention_count: 1 },
  // Activity
  { name: '글라스보트탑승', short_desc: null, long_desc: null, country: '일본', region: '오키나와', badge_type: 'activity', emoji: '🚤', category: 'activity', mention_count: 1 },
  // Hotel
  { name: '라구나가든호텔', short_desc: null, long_desc: null, country: '일본', region: '오키나와', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '류큐오리온호텔국제거리', short_desc: null, long_desc: null, country: '일본', region: '오키나와', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '더블트리바이힐튼슈리캐슬', short_desc: null, long_desc: null, country: '일본', region: '오키나와', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '더비치타워오키나와', short_desc: null, long_desc: null, country: '일본', region: '오키나와', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  // Onsen
  { name: '츄라유온천', short_desc: null, long_desc: null, country: '일본', region: '오키나와', badge_type: 'onsen', emoji: '♨️', category: 'onsen', mention_count: 1 },
  // Meal
  { name: '철판스테이크', short_desc: null, long_desc: null, country: '일본', region: '오키나와', badge_type: 'meal', emoji: '🥩', category: 'meal', mention_count: 1 },
  { name: '무제한샤브샤브', short_desc: null, long_desc: null, country: '일본', region: '오키나와', badge_type: 'meal', emoji: '🥘', category: 'meal', mention_count: 1 },
  { name: '아구샤브샤브', short_desc: null, long_desc: null, country: '일본', region: '오키나와', badge_type: 'meal', emoji: '🐷', category: 'meal', mention_count: 1 },
  // Shopping
  { name: '아시비나아울렛', short_desc: null, long_desc: null, country: '일본', region: '오키나와', badge_type: 'shopping', emoji: '🛍️', category: 'shopping', mention_count: 2 },

  // ============================================================
  // MIYAKOJIMA (1 product)
  // ============================================================
  // Tour
  { name: '17엔드', short_desc: null, long_desc: null, country: '일본', region: '미야코지마', badge_type: 'tour', emoji: '🏖️', category: 'nature', mention_count: 1 },
  { name: '토오리이케', short_desc: null, long_desc: null, country: '일본', region: '미야코지마', badge_type: 'tour', emoji: '💧', category: 'nature', mention_count: 1 },
  { name: '히가시헨나곶', short_desc: null, long_desc: null, country: '일본', region: '미야코지마', badge_type: 'tour', emoji: '🌊', category: 'nature', mention_count: 1 },
  { name: '조개박물관(해보관)', short_desc: null, long_desc: null, country: '일본', region: '미야코지마', badge_type: 'tour', emoji: '🐚', category: 'museum', mention_count: 1 },
  { name: '유키시오뮤지엄', short_desc: null, long_desc: null, country: '일본', region: '미야코지마', badge_type: 'tour', emoji: '🧂', category: 'museum', mention_count: 1 },
  { name: '미야코지마해중공원', short_desc: null, long_desc: null, country: '일본', region: '미야코지마', badge_type: 'tour', emoji: '🐠', category: 'nature', mention_count: 1 },
  { name: '마이파리열대과수원', short_desc: null, long_desc: null, country: '일본', region: '미야코지마', badge_type: 'tour', emoji: '🍍', category: 'nature', mention_count: 1 },
  { name: '이라부대교', short_desc: null, long_desc: null, country: '일본', region: '미야코지마', badge_type: 'tour', emoji: '🌉', category: 'sightseeing', mention_count: 1 },
  { name: '이케마대교&이케마섬', short_desc: null, long_desc: null, country: '일본', region: '미야코지마', badge_type: 'tour', emoji: '🌉', category: 'sightseeing', mention_count: 1 },
  // Onsen
  { name: '시기라오공온센(황금온천)', short_desc: null, long_desc: null, country: '일본', region: '미야코지마', badge_type: 'onsen', emoji: '♨️', category: 'onsen', mention_count: 1 },
  // Hotel
  { name: '호텔브리즈베이마리나', short_desc: null, long_desc: null, country: '일본', region: '미야코지마', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },

  // ============================================================
  // SHIKOKU (4 products)
  // ============================================================
  // Tour
  { name: '리츠린정원', short_desc: null, long_desc: null, country: '일본', region: '가가와', badge_type: 'tour', emoji: '🌳', category: 'park', mention_count: 4 },
  { name: '고토히라신사', short_desc: null, long_desc: null, country: '일본', region: '가가와', badge_type: 'tour', emoji: '⛩️', category: 'temple', mention_count: 4 },
  { name: '몬젠마치', short_desc: null, long_desc: null, country: '일본', region: '가가와', badge_type: 'tour', emoji: '🏮', category: 'shopping', mention_count: 2 },
  { name: '킨료노사토(사케자료관)', short_desc: null, long_desc: null, country: '일본', region: '가가와', badge_type: 'tour', emoji: '🍶', category: 'museum', mention_count: 1 },
  { name: '쇼도시마', short_desc: null, long_desc: null, country: '일본', region: '가가와', badge_type: 'tour', emoji: '🏝️', category: 'nature', mention_count: 2 },
  { name: '엔젤로드', short_desc: null, long_desc: null, country: '일본', region: '가가와', badge_type: 'tour', emoji: '👼', category: 'nature', mention_count: 2 },
  { name: '간카케이(로프웨이)', short_desc: null, long_desc: null, country: '일본', region: '가가와', badge_type: 'tour', emoji: '🚡', category: 'nature', mention_count: 2 },
  { name: '마루킨간장기념관', short_desc: null, long_desc: null, country: '일본', region: '가가와', badge_type: 'tour', emoji: '🏭', category: 'museum', mention_count: 1 },
  { name: '올리브공원', short_desc: null, long_desc: null, country: '일본', region: '가가와', badge_type: 'tour', emoji: '🫒', category: 'park', mention_count: 1 },
  { name: '세토대교', short_desc: null, long_desc: null, country: '일본', region: '가가와', badge_type: 'tour', emoji: '🌉', category: 'sightseeing', mention_count: 2 },
  { name: '세토대교기념공원', short_desc: null, long_desc: null, country: '일본', region: '가가와', badge_type: 'tour', emoji: '🌳', category: 'park', mention_count: 1 },
  { name: '쿠라시키미관지구', short_desc: null, long_desc: null, country: '일본', region: '오카야마', badge_type: 'tour', emoji: '🏘️', category: 'cultural', mention_count: 2 },
  { name: '고라쿠엔', short_desc: null, long_desc: null, country: '일본', region: '오카야마', badge_type: 'tour', emoji: '🌳', category: 'park', mention_count: 1 },
  { name: '오카야마성', short_desc: null, long_desc: null, country: '일본', region: '오카야마', badge_type: 'tour', emoji: '🏯', category: 'palace', mention_count: 1 },
  { name: '나오시마', short_desc: null, long_desc: null, country: '일본', region: '가가와', badge_type: 'tour', emoji: '🎨', category: 'cultural', mention_count: 1 },
  { name: '쿠사마야요이호박', short_desc: null, long_desc: null, country: '일본', region: '가가와', badge_type: 'tour', emoji: '🎃', category: 'cultural', mention_count: 1 },
  { name: '지중미술관', short_desc: null, long_desc: null, country: '일본', region: '가가와', badge_type: 'tour', emoji: '🏛️', category: 'museum', mention_count: 1 },
  { name: '베넷세하우스뮤지엄', short_desc: null, long_desc: null, country: '일본', region: '가가와', badge_type: 'tour', emoji: '🏛️', category: 'museum', mention_count: 1 },
  { name: '이우환미술관', short_desc: null, long_desc: null, country: '일본', region: '가가와', badge_type: 'tour', emoji: '🎨', category: 'museum', mention_count: 1 },
  { name: '아트하우스프로젝트', short_desc: null, long_desc: null, country: '일본', region: '가가와', badge_type: 'tour', emoji: '🎨', category: 'cultural', mention_count: 1 },
  { name: '아이러브유온천', short_desc: null, long_desc: null, country: '일본', region: '가가와', badge_type: 'tour', emoji: '♨️', category: 'onsen', mention_count: 1 },
  { name: '마츠야마성', short_desc: null, long_desc: null, country: '일본', region: '에히메', badge_type: 'tour', emoji: '🏯', category: 'palace', mention_count: 2 },
  { name: '도고온천', short_desc: null, long_desc: null, country: '일본', region: '에히메', badge_type: 'tour', emoji: '♨️', category: 'onsen', mention_count: 4 },
  { name: '도고온천아스카노유별관', short_desc: null, long_desc: null, country: '일본', region: '에히메', badge_type: 'tour', emoji: '♨️', category: 'onsen', mention_count: 1 },
  { name: '봇짱카라쿠리시계탑&아시유', short_desc: null, long_desc: null, country: '일본', region: '에히메', badge_type: 'tour', emoji: '🕰️', category: 'sightseeing', mention_count: 2 },
  { name: '봇짱열차', short_desc: null, long_desc: null, country: '일본', region: '에히메', badge_type: 'tour', emoji: '🚂', category: 'sightseeing', mention_count: 1 },
  { name: '이마바리타올미술관', short_desc: null, long_desc: null, country: '일본', region: '에히메', badge_type: 'tour', emoji: '🎨', category: 'museum', mention_count: 1 },
  { name: '이시테지', short_desc: null, long_desc: null, country: '일본', region: '에히메', badge_type: 'tour', emoji: '⛩️', category: 'temple', mention_count: 1 },
  { name: '오카이도상점가', short_desc: null, long_desc: null, country: '일본', region: '에히메', badge_type: 'tour', emoji: '🛍️', category: 'shopping', mention_count: 1 },
  { name: '쿠루시마해협전망대', short_desc: null, long_desc: null, country: '일본', region: '에히메', badge_type: 'tour', emoji: '🌊', category: 'nature', mention_count: 1 },
  { name: '기로산전망대', short_desc: null, long_desc: null, country: '일본', region: '에히메', badge_type: 'tour', emoji: '🏔️', category: 'nature', mention_count: 1 },
  { name: '하카타소금공장', short_desc: null, long_desc: null, country: '일본', region: '에히메', badge_type: 'tour', emoji: '🧂', category: 'museum', mention_count: 1 },
  { name: '시마나미쿠루시마해협유람선', short_desc: null, long_desc: null, country: '일본', region: '에히메', badge_type: 'tour', emoji: '🚢', category: 'sightseeing', mention_count: 1 },
  { name: '도베야키전통산업회관', short_desc: null, long_desc: null, country: '일본', region: '에히메', badge_type: 'tour', emoji: '🏺', category: 'museum', mention_count: 1 },
  { name: '가미하가저택', short_desc: null, long_desc: null, country: '일본', region: '에히메', badge_type: 'tour', emoji: '🏘️', category: 'cultural', mention_count: 1 },
  { name: '혼하가저택', short_desc: null, long_desc: null, country: '일본', region: '에히메', badge_type: 'tour', emoji: '🏘️', category: 'cultural', mention_count: 1 },
  { name: '오무라가전통가옥', short_desc: null, long_desc: null, country: '일본', region: '에히메', badge_type: 'tour', emoji: '🏘️', category: 'cultural', mention_count: 1 },
  { name: '우치코상업과생활박물관', short_desc: null, long_desc: null, country: '일본', region: '에히메', badge_type: 'tour', emoji: '🏛️', category: 'museum', mention_count: 1 },
  { name: '우치코옛거리', short_desc: null, long_desc: null, country: '일본', region: '에히메', badge_type: 'tour', emoji: '🏘️', category: 'cultural', mention_count: 1 },
  // Onsen
  // 도고온천 already listed as tour above
  // Activity
  { name: '간카케이로프웨이', short_desc: null, long_desc: null, country: '일본', region: '가가와', badge_type: 'activity', emoji: '🚡', category: 'activity', mention_count: 2 },
  { name: '쇼도시마페리', short_desc: null, long_desc: null, country: '일본', region: '가가와', badge_type: 'activity', emoji: '⛴️', category: 'activity', mention_count: 2 },
  { name: '쿠루시마해협유람선', short_desc: null, long_desc: null, country: '일본', region: '에히메', badge_type: 'activity', emoji: '🚢', category: 'activity', mention_count: 1 },
  // Meal
  { name: '사누키우동정식', short_desc: null, long_desc: null, country: '일본', region: '가가와', badge_type: 'meal', emoji: '🍜', category: 'meal', mention_count: 4 },
  { name: '타이메시(도미솥밥)정식', short_desc: null, long_desc: null, country: '일본', region: '에히메', badge_type: 'meal', emoji: '🐟', category: 'meal', mention_count: 2 },
  { name: '간장소프트아이스크림', short_desc: null, long_desc: null, country: '일본', region: '가가와', badge_type: 'meal', emoji: '🍦', category: 'meal', mention_count: 1 },
  // Hotel
  { name: '호텔레오마노모리', short_desc: null, long_desc: null, country: '일본', region: '가가와', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 2 },
  { name: '오쿠도고이치유노모리온천호텔', short_desc: null, long_desc: null, country: '일본', region: '에히메', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 2 },
  { name: '아주르시오노마루호텔', short_desc: null, long_desc: null, country: '일본', region: '에히메', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },

  // ============================================================
  // TSUSHIMA (2 products)
  // ============================================================
  // Tour
  { name: '한국전망대', short_desc: null, long_desc: null, country: '일본', region: '쓰시마', badge_type: 'tour', emoji: '🔭', category: 'sightseeing', mention_count: 2 },
  { name: '미우다해수욕장', short_desc: null, long_desc: null, country: '일본', region: '쓰시마', badge_type: 'tour', emoji: '🏖️', category: 'nature', mention_count: 2 },
  { name: '슈시삼나무길', short_desc: null, long_desc: null, country: '일본', region: '쓰시마', badge_type: 'tour', emoji: '🌲', category: 'nature', mention_count: 2 },
  { name: '에보시다케전망대', short_desc: null, long_desc: null, country: '일본', region: '쓰시마', badge_type: 'tour', emoji: '🏔️', category: 'nature', mention_count: 2 },
  { name: '와타즈미신사', short_desc: null, long_desc: null, country: '일본', region: '쓰시마', badge_type: 'tour', emoji: '⛩️', category: 'temple', mention_count: 2 },
  { name: '만제키바시(만관교)', short_desc: null, long_desc: null, country: '일본', region: '쓰시마', badge_type: 'tour', emoji: '🌉', category: 'sightseeing', mention_count: 2 },
  { name: '금석성', short_desc: null, long_desc: null, country: '일본', region: '쓰시마', badge_type: 'tour', emoji: '🏯', category: 'cultural', mention_count: 1 },
  { name: '덕혜옹주결혼봉축기념비', short_desc: null, long_desc: null, country: '일본', region: '쓰시마', badge_type: 'tour', emoji: '🪦', category: 'cultural', mention_count: 1 },
  { name: '나가라이토스이기념관', short_desc: null, long_desc: null, country: '일본', region: '쓰시마', badge_type: 'tour', emoji: '🏛️', category: 'museum', mention_count: 1 },
  { name: '팔번궁(하치만구)', short_desc: null, long_desc: null, country: '일본', region: '쓰시마', badge_type: 'tour', emoji: '⛩️', category: 'temple', mention_count: 1 },
  { name: '조선통신사비', short_desc: null, long_desc: null, country: '일본', region: '쓰시마', badge_type: 'tour', emoji: '🪦', category: 'cultural', mention_count: 1 },
  { name: '방화벽', short_desc: null, long_desc: null, country: '일본', region: '쓰시마', badge_type: 'tour', emoji: '🧱', category: 'cultural', mention_count: 1 },
  // Onsen
  { name: '유타리랜드온천', short_desc: null, long_desc: null, country: '일본', region: '쓰시마', badge_type: 'onsen', emoji: '♨️', category: 'onsen', mention_count: 2 },
  // Hotel
  { name: '토요코인호텔이즈하라', short_desc: null, long_desc: null, country: '일본', region: '쓰시마', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  { name: '소아루리조트', short_desc: null, long_desc: null, country: '일본', region: '쓰시마', badge_type: 'hotel', emoji: '🏨', category: 'hotel', mention_count: 1 },
  // Meal
  { name: '바베큐특식', short_desc: null, long_desc: null, country: '일본', region: '쓰시마', badge_type: 'meal', emoji: '🍖', category: 'meal', mention_count: 2 },
];

async function main() {
  console.log(`Upserting ${attractions.length} Japan (Modetour) attractions...`);

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
