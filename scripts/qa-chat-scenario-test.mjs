/**
 * QA 채팅 시나리오 테스트 스크립트
 *
 * 사용법:
 *   node scripts/qa-chat-scenario-test.mjs
 *
 * 환경 변수:
 *   BASE_URL (기본: http://localhost:3000)
 *   TEST_MODE (basic | full, 기본: full)
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_PATH = `${BASE_URL}/api/qa/chat`;

// ─── 응답 검증 ───────────────────────────────────────────────────────────
function validateEvents(lines) {
  const errors = [];
  const events = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      errors.push(`JSON 파싱 실패: "${trimmed.slice(0, 80)}"`);
    }
  }

  // 마지막 이벤트는 반드시 done
  const lastEvent = events[events.length - 1];
  if (!lastEvent || lastEvent.type !== 'done') {
    errors.push(`마지막 이벤트가 'done'이 아님: ${JSON.stringify(lastEvent)}`);
  }

  // error 이벤트가 있는지 확인
  const errorEvent = events.find((e) => e.type === 'error');
  if (errorEvent) {
    errors.push(`오류 이벤트 발생: ${errorEvent.message}`);
  }

  // text 또는 text_final 이벤트가 있어야 함
  const hasText = events.some((e) => e.type === 'text' || e.type === 'text_final');
  if (!hasText) {
    errors.push('text 또는 text_final 이벤트 없음');
  }

  // meta 이벤트가 있어야 함
  const hasMeta = events.some((e) => e.type === 'meta');
  if (!hasMeta) {
    errors.push('meta 이벤트 없음');
  }

  return { errors, events };
}

async function testScenario(scenario, index) {
  const startTime = Date.now();
  try {
    const res = await fetch(API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: scenario.message,
        history: scenario.history || [],
        sessionId: crypto.randomUUID(),
      }),
    });

    const elapsed = Date.now() - startTime;
    const text = await res.text();
    const lines = text.split('\n');
    const { errors, events } = validateEvents(lines);

    // 응답 길이 측정
    const fullText = events
      .filter((e) => e.type === 'text' || e.type === 'text_final')
      .map((e) => e.content)
      .join('');

    const metaEvent = events.find((e) => e.type === 'meta');
    const packageCount = metaEvent?.packages?.length ?? 0;
    const escalate = metaEvent?.escalate ?? false;

    return {
      index,
      category: scenario.category,
      label: scenario.label,
      message: scenario.message.slice(0, 60),
      status: res.status,
      ok: res.ok && errors.length === 0,
      elapsed: `${elapsed}ms`,
      responseLength: fullText.length,
      eventCount: events.length,
      packageCount,
      escalate,
      errors: errors.length > 0 ? errors : [],
      responsePreview: fullText ? fullText.replace(/\n/g, ' ').slice(0, 100) + '...' : '(empty)',
    };
  } catch (err) {
    return {
      index,
      category: scenario.category,
      label: scenario.label,
      message: scenario.message.slice(0, 60),
      status: 0,
      ok: false,
      elapsed: `${Date.now() - startTime}ms`,
      responseLength: 0,
      eventCount: 0,
      packageCount: 0,
      escalate: false,
      errors: [`요청 실패: ${err.message}`],
      responsePreview: '',
    };
  }
}

function printDivider(title) {
  console.log('');
  console.log('='.repeat(90));
  console.log(`  ${title}`);
  console.log('='.repeat(90));
}

function printResult(result) {
  const icon = result.ok ? '✅' : '❌';
  const truncated = result.message.length > 55 ? result.message.slice(0, 55) + '…' : result.message;
  console.log(
    `${icon} [${String(result.index).padStart(3)}] ${result.category.padEnd(15)} ${truncated.padEnd(58)} ${result.status} | ${result.elapsed} | ${result.responseLength}B | pkg:${result.packageCount}`,
  );
  if (!result.ok && result.errors.length > 0) {
    for (const err of result.errors) {
      console.log(`     └─ ${err}`);
    }
  }
}

// ─── 시나리오: 100+ 개 ────────────────────────────────────────────────────
const scenarios = [
  // ===== 1. 목적지 문의 (1-15) =====
  { category: '목적지', label: '다낭 패키지 추천', message: '다낭 여행 패키지 추천해주세요' },
  { category: '목적지', label: '방콕 여행 문의', message: '방콕 여행 상품이 있나요? 3박 5일로 알아보고 있어요' },
  { category: '목적지', label: '오사카 겨울 여행', message: '오사카 겨울 여행 패키지 알려주세요' },
  { category: '목적지', label: '괌 가족 여행', message: '괌으로 가족 여행 가려고 하는데 패키지 있나요?' },
  { category: '목적지', label: '사이판 여행', message: '사이판 여행 패키지 추천 부탁드립니다' },
  { category: '목적지', label: '도쿄 자유여행', message: '도쿄 자유여행으로 가려는데 항공+호텔 견적 부탁해요' },
  { category: '목적지', label: '세부 여행 추천', message: '세부 패키지 여행 추천해주세요' },
  { category: '목적지', label: '보라카이 문의', message: '보라카이 여행 상품 문의합니다' },
  { category: '목적지', label: '파타야 여행', message: '파타야 여행 패키지 있나요?' },
  { category: '목적지', label: '하와이 여행', message: '하와이 여행 패키지 추천 좀 해주세요' },
  { category: '목적지', label: '다낭/호이안', message: '다낭이랑 호이안 같이 가는 패키지 있나요?' },
  { category: '목적지', label: '나트랑 문의', message: '나트랑 여행 패키지 가격이 궁금해요' },
  { category: '목적지', label: '방콕/파타야', message: '방콕이랑 파타야 같이 여행하는 상품 있나요?' },
  { category: '목적지', label: '괌/사이판 비교', message: '괌이랑 사이판 중에 어디가 좋을까요?' },
  { category: '목적지', label: '여행지 추천', message: '올 여름에 가기 좋은 여행지 추천해주세요' },

  // ===== 2. 예산/가격 문의 (16-30) =====
  { category: '가격', label: '저렴한 패키지', message: '50만원대 저렴한 해외여행 패키지 알려주세요' },
  { category: '가격', label: '가격 문의', message: '다낭 패키지 가격이 어떻게 되나요?' },
  { category: '가격', label: '할인 문의', message: '패키지 할인이나 프로모션 진행하는 거 있나요?' },
  { category: '가격', label: '얼리버드 할인', message: '얼리버드 할인 적용되는 상품 있나요?' },
  { category: '가격', label: '총 비용 문의', message: '괌 패키지 2인 기준 총 비용 알려주세요' },
  { category: '가격', label: '성수기 가격', message: '여름 성수기 방콕 패키지 가격 알려주세요' },
  { category: '가격', label: '비수기 할인', message: '비수기 때 가면 얼마나 싸지나요?' },
  { category: '가격', label: '가격대 추천', message: '100만원 이하로 갈만한 해외 패키지 추천해주세요' },
  { category: '가격', label: '최저가 문의', message: '오사카 패키지 최저가 얼마에요?' },
  { category: '가격', label: '가성비 여행', message: '가성비 좋은 해외여행 패키지 추천해주세요' },
  { category: '가격', label: '4인 가족 비용', message: '가족 4명이서 다낭 가려는데 총 비용 얼마정도 드나요?' },
  { category: '가격', label: '포함 내역', message: '패키지 가격에 뭐가 포함되나요?' },
  { category: '가격', label: '현지 경비', message: '괌 여행 경비 추가로 얼마 정도 들까요?' },
  { category: '가격', label: '항공료 포함', message: '패키지에 항공료랑 숙소 다 포함된 가격인가요?' },
  { category: '가격', label: '성인/아동 가격', message: '성인이랑 아이 가격이 다른가요?' },

  // ===== 3. 기간/일정 문의 (31-42) =====
  { category: '일정', label: '3박 5일', message: '3박 5일 다낭 패키지 알려주세요' },
  { category: '일정', label: '4박 6일', message: '방콕 4박 6일 일정 추천해주세요' },
  { category: '일정', label: '2박 3일', message: '괌 2박 3일 단기 패키지 있나요?' },
  { category: '일정', label: '일주일 여행', message: '일주일 정도 해외여행 패키지 추천해주세요' },
  { category: '일정', label: '주말 여행', message: '주말에 다녀올 수 있는 해외 패키지 있나요?' },
  { category: '일정', label: '연휴 여행', message: '추석 연휴 때 다녀올 해외 패키지 추천해주세요' },
  { category: '일정', label: '당일치기', message: '당일치기 해외여행 가능한가요?' },
  { category: '일정', label: '1월 여행', message: '1월에 가기 좋은 해외여행 추천해주세요' },
  { category: '일정', label: '5월 여행', message: '5월 초에 다낭 여행 패키지 있나요?' },
  { category: '일정', label: '8월 여름 휴가', message: '8월 여름 휴가로 세부 패키지 추천해주세요' },
  { category: '일정', label: '12월 겨울', message: '12월에 따뜻한 곳으로 여행 가고 싶어요' },
  { category: '일정', label: '10월 가을', message: '10월에 오사카 여행 패키지 알아보고 있어요' },

  // ===== 4. 동행 유형 (43-54) =====
  { category: '동행', label: '신혼여행', message: '신혼여행으로 가기 좋은 패키지 추천해주세요' },
  { category: '동행', label: '커플 여행', message: '커플끼리 가기 좋은 해외여행 패키지 추천해주세요' },
  { category: '동행', label: '가족 여행', message: '초등학생 아이와 함께 가는 가족 여행 패키지 추천해주세요' },
  { category: '동행', label: '부모님 모시고', message: '부모님 모시고 가는 여행 패키지 추천해주세요' },
  { category: '동행', label: '효도 여행', message: '효도 여행으로 괌 패키지 괜찮을까요?' },
  { category: '동행', label: '친구끼리', message: '친구들끼리 가기 좋은 패키지 추천해주세요' },
  { category: '동행', label: '혼자 여행', message: '혼자 여행 가려는데 괜찮은 패키지 있나요?' },
  { category: '동행', label: '단체 여행', message: '회사 워크샵으로 15명 정도 단체 여행 패키지 상담하고 싶어요' },
  { category: '동행', label: '아기랑 여행', message: '돌쟁이 아기랑 다낭 여행 괜찮을까요?' },
  { category: '동행', label: '60대 부모님', message: '60대 부모님 모시고 가는 해외여행 추천해주세요' },
  { category: '동행', label: '대가족 여행', message: '8명 대가족이 갈만한 패키지 있나요?' },
  { category: '동행', label: '엄마랑 여행', message: '엄마랑 둘이 해외여행 가려는데 패키지 추천해주세요' },

  // ===== 5. 취향/테마 (55-71) =====
  { category: '취향', label: '휴양지 추천', message: '그냥 풀빌라에서 쉬다올 수 있는 휴양지 패키지 추천해주세요' },
  { category: '취향', label: '쇼핑 여행', message: '쇼핑하기 좋은 해외여행 패키지 추천해주세요' },
  { category: '취향', label: '맛집 여행', message: '맛집 투어 위주로 하는 패키지 있나요?' },
  { category: '취향', label: '골프 여행', message: '해외 골프 패키지 추천해주세요' },
  { category: '취향', label: '액티비티', message: '스쿠버다이빙이나 서핑 같은 액티비티 포함된 패키지 있나요?' },
  { category: '취향', label: '자유여행', message: '패키지 말고 자유여행으로 다낭 항공+호텔 견적 부탁해요' },
  { category: '취향', label: '패키지 vs 자유', message: '패키지랑 자유여행 중에 뭐가 더 좋을까요?' },
  { category: '취향', label: '문화 탐방', message: '문화유산이나 사찰 같은 거 보는 여행 패키지 추천해주세요' },
  { category: '취향', label: '힐링 여행', message: '힐링 여행지 추천해주세요' },
  { category: '취향', label: '워케이션', message: '워케이션 가능한 패키지 있나요?' },
  { category: '취향', label: '스냅 촬영', message: '스냅촬영 포함된 신혼여행 패키지 있나요?' },
  { category: '취향', label: '미식 여행', message: '미식 여행 위주의 패키지 추천해주세요' },
  { category: '취향', label: '올인클루시브', message: '올인클루시브 리조트 패키지 추천해주세요' },
  { category: '취향', label: '호캉스', message: '호캉스 스타일로 해외 리조트에서 쉬다올 패키지 추천해주세요' },
  { category: '취향', label: '트레킹 여행', message: '해외 트레킹 여행 패키지 있나요?' },
  { category: '취향', label: '성지순례', message: 'K드라마 성지순례 여행 패키지 있나요?' },
  { category: '취향', label: '야경 명소', message: '야경 예쁜 도시로 여행 가고 싶어요 패키지 추천해주세요' },

  // ===== 6. 특정 상품/시설 문의 (72-80) =====
  { category: '상품', label: '호텔 급', message: '5성급 호텔 포함된 패키지 있나요?' },
  { category: '상품', label: '리조트 문의', message: '베이비시터 있는 리조트로 패키지 추천해주세요' },
  { category: '상품', label: '풀빌라', message: '풀빌라 숙소 포함된 패키지 알려주세요' },
  { category: '상품', label: '가이드 포함', message: '한국어 가이드 포함된 패키지 있나요?' },
  { category: '상품', label: '전세기 문의', message: '전세기 패키지는 뭔가요?' },
  { category: '상품', label: '정규팩 vs 전세기', message: '정규팩이랑 전세기 차이가 뭔가요?' },
  { category: '상품', label: '조식 포함', message: '조식 포함된 패키지 알려주세요' },
  { category: '상품', label: '공항 픽업', message: '공항 픽업 포함인가요?' },
  { category: '상품', label: '여행자 보험', message: '여행자 보험도 포함되나요?' },

  // ===== 7. 복합/비교 문의 (81-90) =====
  { category: '비교', label: '다낭 vs 나트랑', message: '다낭이랑 나트랑 중에 어디가 더 좋을까요?' },
  { category: '비교', label: '괌 vs 세부', message: '괌이랑 세부 중에 가족 여행으로는 어디가 나을까요?' },
  { category: '비교', label: '일본 vs 동남아', message: '일본이랑 동남아 중에 어디가 더 싸고 좋을까요?' },
  { category: '비교', label: '패키지 vs 자유', message: '패키지랑 자유여행 중 장단점 알려주세요' },
  { category: '비교', label: '겨울 vs 여름', message: '겨울 여행이 나을까요 여름이 나을까요?' },
  { category: '비교', label: '가족 vs 커플', message: '가족 여행이랑 커플 여행 가기 좋은 곳이 다른가요?' },
  { category: '비교', label: '단품 vs 패키지', message: '항공+호텔만 따로 예약하는 거랑 패키지랑 가격차이 많이 나나요?' },
  { category: '비교', label: '베트남 노선', message: '다낭, 나트랑, 호치민 중에 첫 베트남 여행으로 어디가 좋을까요?' },
  { category: '비교', label: '괌 사이판 차이', message: '괌이랑 사이판 차이점 알려주세요' },
  { category: '비교', label: '동남아 추천', message: '동남아 처음 가는데 어디가 좋을까요?' },

  // ===== 8. 특수 문의/에스컬레이션 (91-100) =====
  { category: '특수', label: '예약 가능 확인', message: '다낭 패키지 7월 15일 출발 예약 가능한가요?' },
  { category: '특수', label: '환불 문의', message: '여행 취소하면 환불 얼마나 되나요?' },
  { category: '특수', label: '변경 문의', message: '예약한 패키지 날짜 변경 가능한가요?' },
  { category: '특수', label: '비자 문의', message: '베트남 비자 꼭 필요한가요?' },
  { category: '특수', label: '여권 문의', message: '여권 만료일 얼마나 남아야 하나요?' },
  { category: '특수', label: '항공편 문의', message: '직항인가요 경유인가요?' },
  { category: '특수', label: '짐 추가', message: '수하물 추가는 어떻게 하나요?' },
  { category: '특수', label: '좌석 지정', message: '비행기 좌석 지정 가능한가요?' },
  { category: '특수', label: '아동 요금', message: '아동 요금이 따로 있나요?' },
  { category: '특수', label: '유아 동반', message: '유아 동반 탑승 가능한가요?' },

  // ===== 9. 부가 서비스 문의 (101-108) =====
  { category: '부가', label: '렌트카', message: '해외 렌트카 예약도 가능한가요?' },
  { category: '부가', label: '투어 예약', message: '현지 투어 예약도 해주나요?' },
  { category: '부가', label: '공항 라운지', message: '공항 라운지 이용권 제공되나요?' },
  { category: '부가', label: '트래블월렛', message: '환전은 어떻게 하나요?' },
  { category: '부가', label: '유심/와이파이', message: '해외 유심이나 와이파이도 제공되나요?' },
  { category: '부가', label: '캐리어 보관', message: '체크아웃하고 캐리어 보관 가능한가요?' },
  { category: '부가', label: '얼리체크인', message: '얼리 체크인 가능한가요?' },
  { category: '부가', label: '레이트 체크아웃', message: '레이트 체크아웃 요청할 수 있나요?' },

  // ===== 10. 에러/엣지 케이스 (109-115) =====
  { category: '엣지', label: '빈 메시지', message: '' },
  { category: '엣지', label: '특수문자', message: '@@@ ### $$$ !!! >>> --- ~~~' },
  { category: '엣지', label: '매우 긴 문장', message: '다낭 방콕 오사카 도쿄 세부 괌 사이판 보라카이 나트랑 하와이 호주 괌 사이판 방콕 파타야 푸켓 치앙마이 홍콩 마카오 대만 상하이 베이징 도쿄 오사카 후쿠오카 삿포로 나고야 홋카이도 가고시마 오키나와 이 모든 곳 패키지 한 번에 추천해주세요' },
  { category: '엣지', label: '영어 메시지', message: 'I want to travel to Da Nang. Please recommend a package for me.' },
  { category: '엣지', label: '영어 메시지 2', message: 'Can you help me find a hotel in Bangkok?' },
  { category: '엣지', label: '존재 하지 않는 목적지', message: '우즈베키스탄 사마르칸트 여행 패키지 있나요?' },
  { category: '엣지', label: '인사만', message: '안녕하세요' },

  // ===== 11. 상담원 연결이 필요한 케이스 (116-120) =====
  { category: '상담원', label: '항공권 환불', message: '항공권 환불 규정이 어떻게 되나요?' },
  { category: '상담원', label: '단체견적', message: '회사 워크샵 20명 단체 견적 부탁드립니다' },
  { category: '상담원', label: '크루즈 문의', message: '크루즈 여행 상품도 있나요?' },
  { category: '상담원', label: '패키지 없음', message: '남극 여행 패키지 있나요?' },
  { category: '상담원', label: '항공편 변경', message: '이미 발권된 항공권 날짜 변경 수수료가 어떻게 되나요?' },

  // ===== 12. 히스토리 있는 대화 (121-125) =====
  {
    category: '히스토리',
    label: '다낭 → 비교',
    message: '그럼 4성급 호텔이랑 5성급 호텔 가격차이가 얼마나 나나요?',
    history: [
      { role: 'user', content: '다낭 패키지 추천해주세요' },
      { role: 'assistant', content: '다낭 여행을 고려하시는군요! 다양한 다낭 패키지가 있습니다. 3박 5일 기준 5성급 호텔 패키지부터 합리적인 4성급 패키지까지 다양하게 준비되어 있습니다.' },
    ],
  },
  {
    category: '히스토리',
    label: '오사카 → 계절',
    message: '벚꽃 시즌에는 얼마나 더 비싼가요?',
    history: [
      { role: 'user', content: '오사카 여행 패키지 알아보고 있어요' },
      { role: 'assistant', content: '오사카는 봄 벚꽃 시즌과 가을 단풍 시즌이 특히 인기가 많습니다. 3박 4일 기준 패키지 상품이 준비되어 있습니다.' },
    ],
  },
  {
    category: '히스토리',
    label: '방콕 → 추가 질문',
    message: '야시장이나 맛집 정보도 알려주실 수 있나요?',
    history: [
      { role: 'user', content: '방콕 여행 패키지 추천해주세요' },
      { role: 'assistant', content: '방콕은 맛집과 야시장이 유명한 도시입니다. 3박 5일 패키지 상품을 추천드립니다.' },
    ],
  },
  {
    category: '히스토리',
    label: '괌 → 액티비티',
    message: '괌에서 스쿠버다이빙 같은 액티비티도 따로 예약할 수 있나요?',
    history: [
      { role: 'user', content: '괌으로 가족 여행 패키지 추천해주세요' },
      { role: 'assistant', content: '괌은 가족 여행지로 매우 좋습니다. 워터파크와 쇼핑몰 등 아이들과 함께 즐기기 좋은 곳입니다.' },
    ],
  },
  {
    category: '히스토리',
    label: '세부 → 짧은 문의',
    message: '첫 여행인데 괜찮을까요?',
    history: [
      { role: 'user', content: '세부 패키지 여행 추천해주세요' },
      { role: 'assistant', content: '세부는 초보 여행자에게도 좋은 여행지입니다. 다양한 패키지 상품이 있습니다.' },
    ],
  },
];

// ─── 메인 ─────────────────────────────────────────────────────────────────
async function main() {
  const mode = process.env.TEST_MODE || 'full';
  const testScenarios = mode === 'basic' ? scenarios.slice(0, 15) : scenarios;

  console.log(`🤖 여소남 OS QA 채팅 시나리오 테스트`);
  console.log(`   엔드포인트: ${API_PATH}`);
  console.log(`   모드: ${mode === 'basic' ? '기본 (처음 15개)' : '전체 (' + testScenarios.length + '개)'}`);
  console.log(`   시작 시각: ${new Date().toLocaleString('ko-KR')}`);

  let passed = 0;
  let failed = 0;
  let totalTime = 0;
  const results = [];

  for (let i = 0; i < testScenarios.length; i++) {
    const scenario = testScenarios[i];
    const result = await testScenario(scenario, i + 1);
    totalTime += parseInt(result.elapsed);
    results.push(result);

    if (result.ok) {
      passed++;
    } else {
      failed++;
    }

    printResult(result);

    // 20개마다 요약
    if ((i + 1) % 20 === 0) {
      const avgMs = Math.round(totalTime / (i + 1));
      console.log(`   ── 중간 요약: ${passed}✅ / ${failed}❌ (평균 ${avgMs}ms) ──`);
    }
  }

  // ─── 최종 결과 ─────────────────────────────────────────────────────────
  const avgMs = Math.round(totalTime / testScenarios.length);
  const passRate = Math.round((passed / testScenarios.length) * 100);

  printDivider('📊 최종 테스트 결과');

  console.log(`   총 시나리오:    ${testScenarios.length}개`);
  console.log(`   통과:           ${passed}개 (${passRate}%)`);
  console.log(`   실패:           ${failed}개`);
  console.log(`   평균 응답 시간: ${avgMs}ms`);
  console.log(`   완료 시각:      ${new Date().toLocaleString('ko-KR')}`);

  // 응답 길이 통계
  const lengths = results.filter((r) => r.ok).map((r) => r.responseLength);
  if (lengths.length > 0) {
    const avgLen = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
    const minLen = Math.min(...lengths);
    const maxLen = Math.max(...lengths);
    console.log(`   응답 길이:       평균 ${avgLen}자 / 최소 ${minLen}자 / 최대 ${maxLen}자`);
  }

  // 패키지 추천 통계
  const withPackages = results.filter((r) => r.packageCount > 0);
  console.log(`   상품 추천 포함:  ${withPackages.length}/${testScenarios.length}개`);
  console.log(`   평균 추천 수:    ${(withPackages.reduce((a, r) => a + r.packageCount, 0) / Math.max(1, withPackages.length)).toFixed(1)}개`);

  // 에스컬레이션 통계
  const escalations = results.filter((r) => r.escalate);
  console.log(`   상담원 전환:     ${escalations.length}개`);

  // 실패 목록
  if (failed > 0) {
    printDivider('❌ 실패 상세 목록');
    for (const r of results.filter((r) => !r.ok)) {
      console.log(`   [${r.index}] ${r.category}: "${r.label}"`);
      console.log(`       메시지: ${r.message}`);
      console.log(`       상태: ${r.status}`);
      for (const err of r.errors) {
        console.log(`       오류: ${err}`);
      }
      console.log('');
    }
  }

  // 종료 코드
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('치명적 오류:', err);
  process.exit(1);
});
