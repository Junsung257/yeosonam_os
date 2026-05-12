#!/usr/bin/env node
/**
 * db/sync_mrt_attractions.js
 *
 * MRT 관광지·호텔 데이터를 attractions 테이블에 전체 수집.
 *
 * 사용법:
 *   node db/sync_mrt_attractions.js [옵션]
 *
 * 플래그:
 *   --city <이름>   특정 도시만
 *   --lists-only    목록만 (상세 인라인 수집 안 함). Phase1 권장
 *   --with-categories  getCategoryList → mrt_city_categories 저장
 *   --enqueue-details  목록 upsert 후 mrt_detail_fetch_queue 적재 (상세는 워커)
 *   --with-desc     인라인으로 상세 최대 50건 (레거시). 큐 방식이면 생략 권장
 *   --dry-run       DB 저장 없이 출력만
 *
 * 저작권 정책:
 *   - mrt_raw_desc 는 내부 전용 (공개 API 응답 제외, 삭제 금지)
 *   - 렌더링 전 process_mrt_descriptions.js 로 DeepSeek 재작성 필수
 *   - mrt_image_url 은 next/image 프록시 경유 (next.config.js remotePatterns)
 */

const { createClient } = require('@supabase/supabase-js');
const cheerio = require('cheerio');
require('dotenv').config({ path: '.env.local' });

const {
  mcpCall,
  sleep,
  fetchTnaDesc,
  fetchStayDesc,
  fetchCategoryList,
} = require('./lib/mrt_mcp_shared');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// ─── Widget 파서 ──────────────────────────────────────────────────────────────

/**
 * MRT widget 응답에서 실제 상품 데이터 추출.
 * ListViewItem.onClickAction.url → gid
 * 내부 Text/Image 노드 탐색 → name, rating, price, imageUrl
 */
function parseWidgetItems(widget) {
  const items = [];

  function traverse(node, acc) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Image' && !acc.imageUrl) {
      acc.imageUrl = (node.src ?? '').split('?')[0]; // 쿼리스트링 제거
    }
    if (node.type === 'Text') {
      const v = node.value ?? '';
      if (node.weight === 'bold' && !acc.name && v.length > 2) {
        acc.name = v.trim();
      }
      if (v.startsWith('⭐')) {
        const mR = v.match(/⭐\s*([\d.]+)/);
        if (mR) acc.rating = parseFloat(mR[1]);
        const mC = v.match(/\((\d+)\)/);
        if (mC) acc.reviewCount = parseInt(mC[1]);
      }
      if (v.includes('원~') || v.includes('원 ~')) {
        const mP = v.replace(/,/g, '').match(/([\d]+)원/);
        if (mP) acc.price = parseInt(mP[1]);
      }
    }
    for (const child of (node.children ?? [])) traverse(child, acc);
  }

  for (const listItem of (widget?.children ?? [])) {
    const url = listItem.onClickAction?.url
      ?? listItem.onClickAction?.payload?.target?.url ?? '';
    const gidMatch = url.match(/\/products\/(\d+)/);
    if (!gidMatch) continue;

    const acc = { gid: gidMatch[1], url, name: '', imageUrl: '', rating: null, reviewCount: null, price: null };
    for (const child of (listItem.children ?? [])) traverse(child, acc);

    if (acc.gid && acc.name) items.push(acc);
  }
  return items;
}

/** badge_type 결정 */
function inferBadge(name, category) {
  const s = ((name ?? '') + ' ' + (category ?? '')).toLowerCase();
  if (s.includes('마사지') || s.includes('massage') || s.includes('스파'))  return 'activity';
  if (s.includes('공연') || s.includes('쇼') || s.includes('show'))         return 'special';
  if (s.includes('골프') || s.includes('golf'))                             return 'golf';
  if (s.includes('티켓') || s.includes('ticket') || s.includes('입장권'))   return 'special';
  return 'tour';
}

// ─── 도시 목록 ───────────────────────────────────────────────────────────────

const TOP_CITIES = [
  // ── 베트남 (13) ─────────────────────────────────────────────────
  { query: '다낭',           region: '다낭',           country: 'VN' },
  { query: '나트랑',         region: '나트랑',         country: 'VN' },
  { query: '하노이',         region: '하노이',         country: 'VN' },
  { query: '호치민',         region: '호치민',         country: 'VN' },
  { query: '푸꾸옥',         region: '푸꾸옥',         country: 'VN' },
  { query: '달랏',           region: '달랏',           country: 'VN' },
  { query: '호이안',         region: '호이안',         country: 'VN' },
  { query: '하롱베이',       region: '하롱베이',       country: 'VN' },
  { query: '사파',           region: '사파',           country: 'VN' },
  { query: '무이네',         region: '무이네',         country: 'VN' },
  { query: '닌빈',           region: '닌빈',           country: 'VN' },
  { query: '하남',           region: '하남',           country: 'VN' },
  { query: '퀴논',           region: '퀴논',           country: 'VN' },
  // ── 태국 (11) ───────────────────────────────────────────────────
  { query: '방콕',           region: '방콕',           country: 'TH' },
  { query: '파타야',         region: '파타야',         country: 'TH' },
  { query: '치앙마이',       region: '치앙마이',       country: 'TH' },
  { query: '푸켓',           region: '푸켓',           country: 'TH' },
  { query: '코사무이',       region: '코사무이',       country: 'TH' },
  { query: '크라비',         region: '크라비',         country: 'TH' },
  { query: '코창',           region: '코창',           country: 'TH' },
  { query: '아유타야',       region: '아유타야',       country: 'TH' },
  { query: '피피섬',         region: '피피',           country: 'TH' },
  { query: '치앙라이',       region: '치앙라이',       country: 'TH' },
  { query: '후아힌',         region: '후아힌',         country: 'TH' },
  // ── 싱가포르 (1) ────────────────────────────────────────────────
  { query: '싱가포르',       region: '싱가포르',       country: 'SG' },
  // ── 인도네시아 (6) ──────────────────────────────────────────────
  { query: '발리',           region: '발리',           country: 'ID' },
  { query: '롬복',           region: '롬복',           country: 'ID' },
  { query: '자카르타',       region: '자카르타',       country: 'ID' },
  { query: '족자카르타',     region: '족자카르타',     country: 'ID' },
  { query: '코모도',         region: '코모도',         country: 'ID' },
  { query: '수라바야',       region: '수라바야',       country: 'ID' },
  // ── 필리핀 (8) ──────────────────────────────────────────────────
  { query: '세부',           region: '세부',           country: 'PH' },
  { query: '보홀',           region: '보홀',           country: 'PH' },
  { query: '마닐라',         region: '마닐라',         country: 'PH' },
  { query: '팔라완',         region: '팔라완',         country: 'PH' },
  { query: '보라카이',       region: '보라카이',       country: 'PH' },
  { query: '다바오',         region: '다바오',         country: 'PH' },
  { query: '시아르가오',     region: '시아르가오',     country: 'PH' },
  { query: '일로일로',       region: '일로일로',       country: 'PH' },
  // ── 말레이시아 (7) ──────────────────────────────────────────────
  { query: '코타키나발루',   region: '코타키나발루',   country: 'MY' },
  { query: '쿠알라룸푸르',   region: '쿠알라룸푸르',   country: 'MY' },
  { query: '페낭',           region: '페낭',           country: 'MY' },
  { query: '랑카위',         region: '랑카위',         country: 'MY' },
  { query: '조호르바루',     region: '조호르바루',     country: 'MY' },
  { query: '사바',           region: '사바',           country: 'MY' },
  { query: '말라카',         region: '말라카',         country: 'MY' },
  // ── 캄보디아 (3) ────────────────────────────────────────────────
  { query: '씨엠립',         region: '씨엠립',         country: 'KH' },
  { query: '프놈펜',         region: '프놈펜',         country: 'KH' },
  { query: '시아누크빌',     region: '시아누크빌',     country: 'KH' },
  // ── 라오스 (2) ──────────────────────────────────────────────────
  { query: '루앙프라방',     region: '루앙프라방',     country: 'LA' },
  { query: '비엔티안',       region: '비엔티안',       country: 'LA' },
  // ── 미얀마 (3) ──────────────────────────────────────────────────
  { query: '양곤',           region: '양곤',           country: 'MM' },
  { query: '바간',           region: '바간',           country: 'MM' },
  { query: '만달레이',       region: '만달레이',       country: 'MM' },
  // ── 일본 (20) ───────────────────────────────────────────────────
  { query: '도쿄',           region: '도쿄',           country: 'JP' },
  { query: '오사카',         region: '오사카',         country: 'JP' },
  { query: '후쿠오카',       region: '후쿠오카',       country: 'JP' },
  { query: '삿포로',         region: '삿포로',         country: 'JP' },
  { query: '교토',           region: '교토',           country: 'JP' },
  { query: '나고야',         region: '나고야',         country: 'JP' },
  { query: '오키나와',       region: '오키나와',       country: 'JP' },
  { query: '히로시마',       region: '히로시마',       country: 'JP' },
  { query: '나라',           region: '나라',           country: 'JP' },
  { query: '고베',           region: '고베',           country: 'JP' },
  { query: '요코하마',       region: '요코하마',       country: 'JP' },
  { query: '하코네',         region: '하코네',         country: 'JP' },
  { query: '유후인',         region: '유후인',         country: 'JP' },
  { query: '벳부',           region: '벳부',           country: 'JP' },
  { query: '나가사키',       region: '나가사키',       country: 'JP' },
  { query: '가고시마',       region: '가고시마',       country: 'JP' },
  { query: '센다이',         region: '센다이',         country: 'JP' },
  { query: '닛코',           region: '닛코',           country: 'JP' },
  { query: '가마쿠라',       region: '가마쿠라',       country: 'JP' },
  { query: '나가노',         region: '나가노',         country: 'JP' },
  // ── 중국 (24) ───────────────────────────────────────────────────
  { query: '서안',           region: '서안',           country: 'CN' },
  { query: '장가계',         region: '장가계',         country: 'CN' },
  { query: '북경',           region: '북경',           country: 'CN' },
  { query: '상해',           region: '상해',           country: 'CN' },
  { query: '칭다오',         region: '칭다오',         country: 'CN' },
  { query: '하이난',         region: '하이난',         country: 'CN' },
  { query: '청두',           region: '청두',           country: 'CN' },
  { query: '계림',           region: '계림',           country: 'CN' },
  { query: '황산',           region: '황산',           country: 'CN' },
  { query: '항저우',         region: '항저우',         country: 'CN' },
  { query: '샤먼',           region: '샤먼',           country: 'CN' },
  { query: '쿤밍',           region: '쿤밍',           country: 'CN' },
  { query: '구채구',         region: '구채구',         country: 'CN' },
  { query: '리장',           region: '리장',           country: 'CN' },
  { query: '따리',           region: '따리',           country: 'CN' },
  { query: '낙양',           region: '낙양',           country: 'CN' },
  { query: '충칭',           region: '충칭',           country: 'CN' },
  { query: '난징',           region: '난징',           country: 'CN' },
  { query: '소주',           region: '소주',           country: 'CN' },
  { query: '대련',           region: '대련',           country: 'CN' },
  { query: '하얼빈',         region: '하얼빈',         country: 'CN' },
  { query: '장춘',           region: '장춘',           country: 'CN' },
  { query: '연태',           region: '연태',           country: 'CN' },
  { query: '주하이',         region: '주하이',         country: 'CN' },
  // ── 대만 (5) ────────────────────────────────────────────────────
  { query: '타이베이',       region: '타이베이',       country: 'TW' },
  { query: '타이중',         region: '타이중',         country: 'TW' },
  { query: '가오슝',         region: '가오슝',         country: 'TW' },
  { query: '타이난',         region: '타이난',         country: 'TW' },
  { query: '화롄',           region: '화롄',           country: 'TW' },
  // ── 홍콩/마카오 (2) ─────────────────────────────────────────────
  { query: '홍콩',           region: '홍콩',           country: 'HK' },
  { query: '마카오',         region: '마카오',         country: 'MO' },
  // ── 한국 국내 (12) ──────────────────────────────────────────────
  { query: '제주',           region: '제주',           country: 'KR' },
  { query: '부산',           region: '부산',           country: 'KR' },
  { query: '경주',           region: '경주',           country: 'KR' },
  { query: '강릉',           region: '강릉',           country: 'KR' },
  { query: '전주',           region: '전주',           country: 'KR' },
  { query: '여수',           region: '여수',           country: 'KR' },
  { query: '서울',           region: '서울',           country: 'KR' },
  { query: '인천',           region: '인천',           country: 'KR' },
  { query: '수원',           region: '수원',           country: 'KR' },
  { query: '통영',           region: '통영',           country: 'KR' },
  { query: '가평',           region: '가평',           country: 'KR' },
  { query: '속초',           region: '속초',           country: 'KR' },
  // ── 중앙아시아/코카서스 (6) ─────────────────────────────────────
  { query: '몽골',           region: '울란바토르',     country: 'MN' },
  { query: '우즈베키스탄',   region: '사마르칸트',     country: 'UZ' },
  { query: '카자흐스탄',     region: '알마티',         country: 'KZ' },
  { query: '조지아',         region: '트빌리시',       country: 'GE' },
  { query: '아제르바이잔',   region: '바쿠',           country: 'AZ' },
  { query: '아르메니아',     region: '예레반',         country: 'AM' },
  // ── 인도/남아시아 (6) ───────────────────────────────────────────
  { query: '몰디브',         region: '몰디브',         country: 'MV' },
  { query: '스리랑카',       region: '콜롬보',         country: 'LK' },
  { query: '인도',           region: '델리',           country: 'IN' },
  { query: '뭄바이',         region: '뭄바이',         country: 'IN' },
  { query: '네팔',           region: '카트만두',       country: 'NP' },
  { query: '부탄',           region: '팀부',           country: 'BT' },
  // ── 중동 (9) ────────────────────────────────────────────────────
  { query: '두바이',         region: '두바이',         country: 'AE' },
  { query: '아부다비',       region: '아부다비',       country: 'AE' },
  { query: '터키',           region: '이스탄불',       country: 'TR' },
  { query: '카파도키아',     region: '카파도키아',     country: 'TR' },
  { query: '이집트',         region: '카이로',         country: 'EG' },
  { query: '요르단',         region: '암만',           country: 'JO' },
  { query: '이스라엘',       region: '텔아비브',       country: 'IL' },
  { query: '오만',           region: '무스카트',       country: 'OM' },
  { query: '카타르',         region: '도하',           country: 'QA' },
  // ── 오세아니아 (12) ─────────────────────────────────────────────
  { query: '시드니',         region: '시드니',         country: 'AU' },
  { query: '멜버른',         region: '멜버른',         country: 'AU' },
  { query: '골드코스트',     region: '골드코스트',     country: 'AU' },
  { query: '케언즈',         region: '케언즈',         country: 'AU' },
  { query: '브리즈번',       region: '브리즈번',       country: 'AU' },
  { query: '퍼스',           region: '퍼스',           country: 'AU' },
  { query: '뉴질랜드',       region: '오클랜드',       country: 'NZ' },
  { query: '퀸스타운',       region: '퀸스타운',       country: 'NZ' },
  { query: '괌',             region: '괌',             country: 'GU' },
  { query: '사이판',         region: '사이판',         country: 'MP' },
  { query: '하와이',         region: '호놀룰루',       country: 'US' },
  { query: '피지',           region: '피지',           country: 'FJ' },
  // ── 유럽 (30) ───────────────────────────────────────────────────
  { query: '파리',           region: '파리',           country: 'FR' },
  { query: '니스',           region: '니스',           country: 'FR' },
  { query: '로마',           region: '로마',           country: 'IT' },
  { query: '피렌체',         region: '피렌체',         country: 'IT' },
  { query: '베네치아',       region: '베네치아',       country: 'IT' },
  { query: '밀라노',         region: '밀라노',         country: 'IT' },
  { query: '나폴리',         region: '나폴리',         country: 'IT' },
  { query: '바르셀로나',     region: '바르셀로나',     country: 'ES' },
  { query: '마드리드',       region: '마드리드',       country: 'ES' },
  { query: '세비야',         region: '세비야',         country: 'ES' },
  { query: '런던',           region: '런던',           country: 'GB' },
  { query: '에딘버러',       region: '에딘버러',       country: 'GB' },
  { query: '암스테르담',     region: '암스테르담',     country: 'NL' },
  { query: '프라하',         region: '프라하',         country: 'CZ' },
  { query: '비엔나',         region: '비엔나',         country: 'AT' },
  { query: '스위스',         region: '취리히',         country: 'CH' },
  { query: '인터라켄',       region: '인터라켄',       country: 'CH' },
  { query: '그리스',         region: '아테네',         country: 'GR' },
  { query: '산토리니',       region: '산토리니',       country: 'GR' },
  { query: '크로아티아',     region: '두브로브니크',   country: 'HR' },
  { query: '포르투갈',       region: '리스본',         country: 'PT' },
  { query: '독일',           region: '뮌헨',           country: 'DE' },
  { query: '핀란드',         region: '헬싱키',         country: 'FI' },
  { query: '아이슬란드',     region: '레이캬비크',     country: 'IS' },
  { query: '부다페스트',     region: '부다페스트',     country: 'HU' },
  { query: '바르샤바',       region: '바르샤바',       country: 'PL' },
  { query: '브뤼셀',         region: '브뤼셀',         country: 'BE' },
  { query: '코펜하겐',       region: '코펜하겐',       country: 'DK' },
  { query: '스톡홀름',       region: '스톡홀름',       country: 'SE' },
  { query: '더블린',         region: '더블린',         country: 'IE' },
  // ── 미주 (14) ───────────────────────────────────────────────────
  { query: '뉴욕',           region: '뉴욕',           country: 'US' },
  { query: '로스앤젤레스',   region: 'LA',             country: 'US' },
  { query: '라스베이거스',   region: '라스베이거스',   country: 'US' },
  { query: '샌프란시스코',   region: '샌프란시스코',   country: 'US' },
  { query: '시카고',         region: '시카고',         country: 'US' },
  { query: '마이애미',       region: '마이애미',       country: 'US' },
  { query: '올랜도',         region: '올랜도',         country: 'US' },
  { query: '캐나다',         region: '밴쿠버',         country: 'CA' },
  { query: '토론토',         region: '토론토',         country: 'CA' },
  { query: '멕시코',         region: '칸쿤',           country: 'MX' },
  { query: '쿠바',           region: '아바나',         country: 'CU' },
  { query: '페루',           region: '리마',           country: 'PE' },
  { query: '아르헨티나',     region: '부에노스아이레스', country: 'AR' },
  { query: '브라질',         region: '리우데자네이루', country: 'BR' },
  // ── 아프리카 (5) ────────────────────────────────────────────────
  { query: '모로코',         region: '마라케시',       country: 'MA' },
  { query: '케냐',           region: '나이로비',       country: 'KE' },
  { query: '탄자니아',       region: '다르에스살람',   country: 'TZ' },
  { query: '잔지바르',       region: '잔지바르',       country: 'TZ' },
  { query: '남아공',         region: '케이프타운',     country: 'ZA' },
];

// ─── 수집 함수 ────────────────────────────────────────────────────────────────

/** TNA 전체 페이지 수집 (최대 500건) */
async function fetchAllTnas(cityQuery) {
  const all = [];
  const PER_PAGE = 100;
  for (let page = 1; page <= 5; page++) {
    const raw = await mcpCall('searchTnas', { query: cityQuery, perPage: PER_PAGE, page });
    if (!raw) break;
    const items = parseWidgetItems(raw.widget) ?? [];
    if (!items.length) break;
    all.push(...items.map(i => ({ ...i, _type: 'tna' })));
    if (items.length < PER_PAGE) break;
    await jitterDelay();
  }
  return all;
}

/** Stay 수집 */
async function fetchAllStays(cityQuery) {
  const today    = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  const raw = await mcpCall('searchStays', {
    keyword: cityQuery, checkIn: today, checkOut: tomorrow,
    adultCount: 2, childCount: 0, isDomestic: false, page: 1, pageSize: 100,
  });
  if (!raw) return [];
  return (parseWidgetItems(raw.widget) ?? []).map(i => ({ ...i, _type: 'stay' }));
}

// ─── 도시별 카테고리(칩) ─────────────────────────────────────────────────────

async function persistCategories(city, dryRun) {
  const cats = await fetchCategoryList(city.query);
  if (!cats.length) {
    console.log('  → 카테고리 0건 (응답 없음)');
    return;
  }
  if (dryRun) {
    console.log(`  [dry-run] 카테고리 ${cats.length}건`, cats.slice(0, 5));
    return;
  }
  const now = new Date().toISOString();
  const rows = cats.map(c => ({
    city_query: city.query,
    region: city.region,
    country: city.country,
    category_ext_id: c.category_ext_id,
    category_name: c.category_name,
    item_count: c.item_count,
    synced_at: now,
  }));
  const { error } = await supabase
    .from('mrt_city_categories')
    .upsert(rows, { onConflict: 'city_query,category_name' });
  if (error) console.error(`  [카테고리 오류] ${error.message}`);
  else console.log(`  ✓ 카테고리 ${rows.length}건 저장`);
}

// ─── 상세 큐 적재 (done/processing 은 건너뜀) ─────────────────────────────────

async function enqueueDetailJobs(rows) {
  let enq = 0;
  for (const r of rows) {
    if (!r.mrt_gid) continue;
    const { data: ex, error: selErr } = await supabase
      .from('mrt_detail_fetch_queue')
      .select('status')
      .eq('mrt_gid', r.mrt_gid)
      .maybeSingle();
    if (selErr) {
      console.error(`  [큐 조회 오류] ${selErr.message}`);
      continue;
    }
    if (ex?.status === 'done' || ex?.status === 'processing') continue;

    const { error } = await supabase.from('mrt_detail_fetch_queue').upsert(
      {
        mrt_gid: r.mrt_gid,
        mrt_category: r.mrt_category,
        provider_url: r.mrt_provider_url ?? null,
        status: 'pending',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'mrt_gid' },
    );
    if (error) console.error(`  [큐 upsert] ${r.mrt_gid}: ${error.message}`);
    else enq++;
  }
  if (enq) console.log(`  ✓ 상세 큐 반영 ${enq}건 (신규/갱신)`);
}

// ─── 도시 동기화 ──────────────────────────────────────────────────────────────

async function syncCity(city, opts) {
  const { withDesc, dryRun, withCategories, enqueueDetails } = opts;
  console.log(`\n[${city.query}] 동기화 시작${withDesc ? ' (인라인 설명)' : ''}...`);

  const [tnas, stays] = await Promise.all([
    fetchAllTnas(city.query),
    fetchAllStays(city.query),
  ]);
  console.log(`  → 투어 ${tnas.length}건, 호텔 ${stays.length}건 수집`);

  const syncedAt = new Date().toISOString();
  const rows = [];
  let descFetched = 0;

  for (const t of tnas) {
    const row = {
      mrt_gid:            t.gid,
      mrt_category:       'tna',
      mrt_rating:         t.rating,
      mrt_review_count:   t.reviewCount,
      mrt_min_price:      t.price,
      mrt_image_url:      t.imageUrl || null,
      mrt_provider_url:   t.url || null,
      mrt_synced_at:      syncedAt,
      name:               t.name,
      badge_type:         inferBadge(t.name, ''),
      region:             city.region,
      country:            city.country,
      is_active:          true,
    };
    if (withDesc && descFetched < 50 && t.url) {
      const desc = await fetchTnaDesc(t.gid, t.url);
      if (desc) { row.mrt_raw_desc = desc; row.ai_processed_at = null; descFetched++; }
    }
    rows.push(row);
  }

  for (const s of stays) {
    const row = {
      mrt_gid:            s.gid,
      mrt_category:       'stay',
      mrt_rating:         s.rating,
      mrt_review_count:   s.reviewCount,
      mrt_min_price:      s.price,
      mrt_image_url:      s.imageUrl || null,
      mrt_provider_url:   s.url || null,
      mrt_synced_at:      syncedAt,
      name:               s.name,
      badge_type:         'hotel',
      region:             city.region,
      country:            city.country,
      is_active:          true,
    };
    if (withDesc && descFetched < 50) {
      const desc = await fetchStayDesc(s.gid);
      if (desc) { row.mrt_raw_desc = desc; row.ai_processed_at = null; descFetched++; }
    }
    rows.push(row);
  }

  if (withDesc) console.log(`  → 설명 수집: ${descFetched}건`);

  if (dryRun) {
    console.log(`  [dry-run] 저장 예정: ${rows.length}건`);
    if (rows[0]) console.log('  샘플:', JSON.stringify({ ...rows[0], mrt_raw_desc: rows[0].mrt_raw_desc?.slice(0, 100) }, null, 2));
    if (withCategories) await persistCategories(city, dryRun);
    return rows.length;
  }
  if (!rows.length) {
    if (withCategories) await persistCategories(city, dryRun);
    return 0;
  }

  const BATCH = 500;
  let saved = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase
      .from('attractions')
      .upsert(rows.slice(i, i + BATCH), { onConflict: 'mrt_gid', ignoreDuplicates: false });
    if (error) console.error(`  [오류] ${error.message}`);
    else saved += Math.min(BATCH, rows.length - i);
  }
  console.log(`  ✓ ${saved}건 저장 완료`);

  if (withCategories) await persistCategories(city, dryRun);
  if (enqueueDetails && !dryRun) await enqueueDetailJobs(rows);

  return saved;
}

// ─── 진입점 ───────────────────────────────────────────────────────────────────

async function main() {
  const args     = process.argv.slice(2);
  const dryRun   = args.includes('--dry-run');
  const listsOnly = args.includes('--lists-only');
  const withDesc = args.includes('--with-desc') && !listsOnly;
  const withCategories = args.includes('--with-categories');
  const enqueueDetails = args.includes('--enqueue-details');
  const cityIdx  = args.indexOf('--city');
  const cityArg  = cityIdx !== -1 ? args[cityIdx + 1] : null;

  let cities;
  if (cityArg) {
    cities = TOP_CITIES.filter(c => c.query === cityArg || c.region === cityArg);
    if (!cities.length) {
      console.error(`[오류] 도시 "${cityArg}"를 찾을 수 없습니다.`);
      console.log('지원 도시:', TOP_CITIES.map(c => c.query).join(', '));
      process.exit(1);
    }
  } else {
    cities = TOP_CITIES;
  }

  console.log('MRT → attractions 동기화');
  console.log(
    `모드: ${dryRun ? 'DRY RUN' : '실제 저장'} | 목록만: ${listsOnly ? 'YES' : 'NO'} | 인라인설명: ${withDesc ? 'ON' : 'OFF'} | 카테고리: ${withCategories ? 'ON' : 'OFF'} | 큐적재: ${enqueueDetails ? 'ON' : 'OFF'}`,
  );
  console.log(`대상 도시 수: ${cities.length}`);

  let total = 0;
  for (let i = 0; i < cities.length; i++) {
    total += await syncCity(cities[i], {
      withDesc,
      dryRun,
      withCategories,
      enqueueDetails,
    });
    if (i < cities.length - 1) await sleep(2000);
  }
  console.log(`\n완료: 총 ${total}건 목록 upsert (도시당 카테고리/큐는 로그 참고)`);
}

main().catch(err => { console.error('[치명적 오류]', err); process.exit(1); });
