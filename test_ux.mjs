import { createInterface } from 'readline';

const BASE_URL = 'http://localhost:3000';

const TEST_CASES = [
  { msg: '다낭 6월 특가 있나요?', desc: '기본 특가 문의' },
  { msg: '다낭 4박 6일 패키지 알려줘', desc: '기간 지정 문의' },
  { msg: '부산 출발 다낭 패키지 추천해줘', desc: '출발지 필터 문의' },
  { msg: '인천 출발 동남아 특가 알려줘', desc: '출발지+지역 문의' },
  { msg: '가족끼리 가기 좋은 동남아 패키지 추천해줘', desc: '가족 여행 추천' },
  { msg: '신혼여행으로 가기 좋은 패키지 있어?', desc: '신혼여행 추천' },
  { msg: '혼자 여행 가고 싶은데 괜찮은 패키지 있어?', desc: '혼행 추천' },
  { msg: '노팁 노옵션 패키지 알려줘', desc: '조건 필터' },
  { msg: '다낭 7박 9일 패키지 있어?', desc: '없는 일수 질문 → 대안 제시 확인' },
  { msg: '6월 30일 출발 다낭 특가 알려줘', desc: '특정 날짜 질문 → 대안 제시 확인' },
  { msg: '제주도 패키지 추천해줘', desc: '취급 안 하는 지역 → 대안 제시 확인' },
  { msg: '괌 5박 7일 패키지 있어?', desc: '취급 안 하는 지역+일정 → 대안 제시 확인' },
  { msg: '다낭 3박 5일 가장 저렴한 상품 알려줘', desc: '가격 순 추천 확인' },
  { msg: '5성급 호텔 포함 다낭 패키지 있어?', desc: '호텔 조건 문의' },
  { msg: '베트남 패키지 전체 알려줘', desc: '다수 상품 출력 UX 확인' },
  { msg: '동남아 6월 특가 총정리 해줘', desc: '종합 정보 UX 확인' },
];

function checkAirlineCode(text) {
  const codeMap = { BX: '에어부산', LJ: '진에어', KE: '대한항공', OZ: '아시아나', '7C': '제주항공', RS: '에어서울', RF: '이스타항공', ZE: '티웨이', TW: '티웨이', VN: '베트남항공', QH: '뱀부에어웨이즈' };
  for (const [code] of Object.entries(codeMap)) {
    const re = new RegExp('\\b' + code + '\\b');
    if (re.test(text) && !text.includes(codeMap[code])) return code;
  }
  return null;
}

function hasKoreanAirlineName(text) {
  return /에어부산|진에어|대한항공|아시아나|제주항공|에어서울|이스타|티웨이|베트남항공|뱀부에어웨이즈/.test(text);
}

function hasNegativeEnding(text) {
  const ends = text.trim();
  const negPattern = /(없습니다|없어요|없고요|불가능합니다|준비되지 않았습니다)[.~!]*\s*$/;
  const m = ends.match(negPattern);
  if (m) {
    const after = ends.slice(ends.lastIndexOf(m[1]) + m[1].length);
    if (!after.includes('대신') && !after.includes('추천') && !after.includes('?')) return m[1];
  }
  return null;
}

function hasEmojis(text) {
  const required = ['💰', '🏨', '✈️'];
  const missing = required.filter(e => !text.includes(e));
  return { ok: missing.length === 0, missing };
}

function hasSeparators(text) {
  return { ok: text.includes('---'), count: (text.match(/---/g) || []).length };
}

function hasLinks(text) {
  const links = text.match(/\/packages\/[a-zA-Z0-9-]+/g);
  return { ok: links && links.length > 0, count: links ? links.length : 0 };
}

async function getReply(message) {
  const response = await fetch(`${BASE_URL}/api/qa/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!response.ok) return null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let done = false;

  while (!done) {
    const { value, done: d } = await reader.read();
    done = d;
    if (value) {
      fullText += decoder.decode(value, { stream: true });
    }
  }

  // NDJSON: 각 줄을 파싱해서 text 이벤트의 content를 모두 합침
  let reply = '';
  const lines = fullText.split('\n').filter(l => l.trim());
  for (const line of lines) {
    try {
      const ev = JSON.parse(line);
      if (ev.type === 'text' && ev.content) {
        reply += ev.content;
      } else if (ev.type === 'text_final' && ev.content) {
        reply += ev.content;
      } else if (ev.type === 'meta') {
        // meta event — pass
      } else if (ev.type === 'error') {
        console.log('  ⚠️ API error event:', ev.message);
        return null;
      }
    } catch (e) {
      // skip unparseable lines
    }
  }
  return reply || null;
}

async function run() {
  console.log('===== QA 챗봇 UX 테스트 =====');
  console.log(`시나리오: ${TEST_CASES.length}개\n`);

  let passed = 0;
  let totalScore = 0;
  const MAX_SCORE = TEST_CASES.length * 25;

  for (const [i, tc] of TEST_CASES.entries()) {
    const n = i + 1;
    process.stdout.write(`[${n}/${TEST_CASES.length}] ${tc.desc}: "${tc.msg}"\n`);

    const reply = await getReply(tc.msg);
    if (!reply) {
      console.log('  ❌ 응답 없음\n');
      continue;
    }

    let score = 0;
    const issues = [];

    // 1. 항공코드 검사 (10점)
    const code = checkAirlineCode(reply);
    if (code) {
      issues.push(`항공코드 "${code}" 미변환`);
    } else if (hasKoreanAirlineName(reply)) {
      score += 10;
    } else {
      // 코드도 없고 한글 항공사명도 없으면 중립
      score += 5;
    }

    // 2. 링크 검사 (5점)
    const lc = hasLinks(reply);
    if (lc.ok) {
      score += 5;
    } else {
      issues.push('상품 링크(/packages/id) 없음');
    }

    // 3. 부정 종결 검사 (5점)
    const neg = hasNegativeEnding(reply);
    if (neg) {
      issues.push(`부정 종결: "${neg}"`);
    } else {
      score += 5;
    }

    // 4. 이모지 검사 (3점)
    const emj = hasEmojis(reply);
    if (emj.ok) {
      score += 3;
    } else {
      issues.push(`이모지 누락: ${emj.missing.join(',')}`);
    }

    // 5. 구분선 검사 (2점)
    const sep = hasSeparators(reply);
    if (sep.ok) {
      score += 2;
    } else {
      issues.push('--- 구분선 없음');
    }

    totalScore += score;
    const ok = score >= 20;
    if (ok) passed++;

    const icon = score >= 20 ? '✅' : score >= 15 ? '⚠️' : '❌';
    process.stdout.write(`  ${icon} ${score}/25\n`);
    if (issues.length) {
      issues.forEach(x => process.stdout.write(`    └ ${x}\n`));
    }

    // 미리보기 (1줄)
    const preview = reply.replace(/\n/g, ' ').substring(0, 180);
    process.stdout.write(`  📝 ${preview}...\n\n`);
  }

  const pct = Math.round((totalScore / MAX_SCORE) * 100);
  console.log('===== 결과 =====');
  console.log(`통과: ${passed}/${TEST_CASES.length}`);
  console.log(`총점: ${totalScore}/${MAX_SCORE} (${pct}%)`);
  console.log(`평가: ${pct >= 80 ? '🎉 우수' : pct >= 60 ? '⚠️ 보통' : '❌ 미흡'}`);
}

run().catch(e => console.error('Fatal:', e));
