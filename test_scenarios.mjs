// QA Chatbot 시나리오 테스트 스크립트
import { writeFileSync, mkdirSync } from 'fs';

const BASE_URL = 'http://localhost:3001/api/qa/chat';
const SCENARIOS = [
  { id: 'sc-01', msg: '다낭 6월에 특가 있어?' },
  { id: 'sc-02', msg: '부산출발 다낭 6월 특가 알려줘' },
  { id: 'sc-03', msg: '다낭 6일 일정으로 갈 수 있는 패키지 있어?', expected: '다낭 상품은 주로 3박5일(5일)입니다만' },
  { id: 'sc-04', msg: '인천출발 특가 패키지 추천해줘' },
  { id: 'sc-05', msg: '부산출발 6월 30일 동남아 특가 알려줘' },
  { id: 'sc-06', msg: '나트랑 3박5일 골프 패키지 문의' },
  { id: 'sc-07', msg: '보홀이랑 다낭 중에 고민중인데, 4인가족 여행 추천해줘' },
  { id: 'sc-08', msg: '푸꾸옥 5성 호텔 패키지 있나?' },
  { id: 'sc-09', msg: '부모님 모시고 효도여행 가려는데 다낭vs나트랑 어디가 좋을까요?' },
  { id: 'sc-10', msg: '허니문으로 보홀 4박6일 알아보고 있어' },
  { id: 'sc-11', msg: '다낭 3박5일 가성비 좋은 걸로 추천해줘' },
  { id: 'sc-12', msg: '부산에서 보홀 직항 패키지 있나요? 7월초 2명' },
];

mkdirSync('test-results', { recursive: true });

function parseNDJSON(text) {
  const events = text.trim().split('\n').filter(l => l).map(l => JSON.parse(l));
  const reply = events.filter(e => e.type === 'text' || e.type === 'text_final').map(e => e.content).join('');
  const meta = events.find(e => e.type === 'meta');
  const error = events.find(e => e.type === 'error');
  return { reply, meta, error, raw: text };
}

function evaluateReply(reply, msg) {
  const checks = [];
  const score = { total: 0, max: 100 };
  
  // 1. 응답 존재 (20점)
  if (reply && reply.length > 20) {
    score.total += 20;
    checks.push('✅ 응답 존재');
  } else {
    checks.push('❌ 응답 없음');
  }
  
  // 2. ★ 대안 종결 검증 (20점) — CRITICAL: 부정적 종결 없이 대안 제시로 끝나는가?
  const hasNegativeEnding = /(없습니다|없어요|없고요|없습니다\.$|없어요\.$|없습니다\.\"|없어요\.\"|만\s*있습니다|만\s*있어요)\s*$/.test(reply.trim().replace(/["']/g, ''));
  const hasAlternative = /대신|추천|어떠세요|어떨까|이런\s*건|이\s*상품|다른\s*상품|자유여행|맞춤\s*일정|알아볼까|도와드/.test(reply);
  const endsWithQuestion = /(어떠세요\?|어떨까요\?|알려주세요\.?|도와드릴까요\?|궁금하신가요\?|하실래요\?|좋을까요\?|드릴까요\?)/.test(reply);
  
  if (hasNegativeEnding && !hasAlternative && !endsWithQuestion) {
    checks.push('❌ [CRITICAL] 부정적 종결 — 대안 제시 없이 끝남');
    // Large penalty: max 20점 중 0점
  } else if (hasNegativeEnding && hasAlternative) {
    checks.push('⚠️ 부정 표현 있으나 대안 함께 제시');
    score.total += 15;
  } else if (endsWithQuestion || hasAlternative) {
    score.total += 20;
    checks.push('✅ 긍정적 종결 — 대안/질문으로 마무리');
  } else {
    checks.push('⚠️ 종결 방식 모호');
    score.total += 10;
  }
  
  // 3. 공감/배려 표현 (15점)
  if (/안녕|감사|걱정|설레|궁금|부담|즐거|좋겠|도와드|추천해드/.test(reply)) {
    score.total += 15;
    checks.push('✅ 공감/배려 표현');
  } else {
    checks.push('❌ 공감 표현 부족');
  }
  
  // 4. 추천 이유 포함 (20점)
  if (/왜|이유|적합|좋은|때문|추천|추천드/.test(reply)) {
    score.total += 20;
    checks.push('✅ 추천 이유 포함');
  } else {
    checks.push('❌ 추천 이유 부족');
  }
  
  // 5. 자연스러운 존댓말 (10점)
  if (/요|니다|네요|네,|죠/.test(reply)) {
    score.total += 10;
    checks.push('✅ 자연스러운 말투');
  } else {
    checks.push('❌ 말투 부자연');
  }
  
  // 6. 구체적인 상품 정보 (15점)
  if (/박|일|원|만원|포함|호텔|항공/.test(reply)) {
    score.total += 15;
    checks.push('✅ 구체적 상품 정보');
  } else {
    checks.push('❌ 상품 정보 부족');
  }
  
  // 7. 컨텍스트 활용 (맥락 반영) (—점, bonus)
  const contextWords = msg.includes('부산') ? '부산' : 
                       msg.includes('인천') ? '인천' :
                       msg.includes('부모님') ? '부모|효도' :
                       msg.includes('허니문') ? '허니문|커플' :
                       msg.includes('가족') ? '가족' : '';
  if (contextWords && new RegExp(contextWords).test(reply)) {
    score.total += 0; // already accounted in other criteria
    checks.push('✅ 문의맥락 반영');
  } else if (!contextWords) {
    checks.push('✅ (맥락 불필요)');
  } else {
    checks.push('⚠️ 문의맥락 미반영');
  }
  
  // Bonus: 여러 대안 제시 (최대 +5)
  const alternativeCount = (reply.match(/첫째|둘째|셋째|첫번째|두번째|하나는|다른|또는|아니면|~도\s*있|~도\s*준비/g) || []).length;
  if (alternativeCount >= 2) {
    score.total += 5;
    checks.push('✅ 2+ 대안 제시 (+5)');
  } else if (alternativeCount >= 1) {
    score.total += 2;
    checks.push('✅ 1개 대안 제시 (+2)');
  }
  
  // 8. ★ 항공코드 사용 검증 (10점) — BX/LJ/KE 등 코드 대신 항공사명 사용?
  const airlineCodes = /\b(BX|LJ|KE|OZ|7C|RS|RF|ZE|TW)\b/g;
  const airlineCodeMatches = reply.match(airlineCodes);
  const airlineKoreanNames = /에어부산|진에어|대한항공|아시아나|제주항공|티웨이|이스타|에어서울|베트남항공/g;
  if (airlineCodeMatches) {
    checks.push(`❌ 항공코드 사용 (${airlineCodeMatches.join(', ')}) → 항공사명으로 변환 필요`);
    // 그대로 코드 썼으므로 감점
  } else if (airlineKoreanNames.test(reply)) {
    score.total += 10;
    checks.push('✅ 항공사명 사용 (고객 친화적)');
  } else {
    // 항공 관련 내용이 없는 경우도 OK
    checks.push('✅ (항공정보 미포함)');
  }
  
  // 9. ★ 상품 링크 포함 검증 (5점)
  if (/\/packages\/[a-f0-9-]{36}/.test(reply)) {
    score.total += 5;
    checks.push('✅ 상품 링크 포함');
  } else {
    checks.push('⚠️ 상품 링크 미포함');
  }
  
  // 10. 가독성 포맷 (5점) — 이모지/구분선 활용?
  if (/---/.test(reply)) {
    score.total += 2;
    checks.push('✅ 구분선 활용');
  }
  if (/💰|🏨|✈️|📅|⭐/.test(reply)) {
    score.total += 3;
    checks.push('✅ 시각적 이모지 사용');
  }
  
  return { score: Math.min(score.total, 100), checks };
}

async function runAll() {
  const results = [];
  
  for (const sc of SCENARIOS) {
    console.log(`\n=== [${sc.id}] ${sc.msg} ===`);
    
    try {
      const res = await fetch(BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: sc.msg,
          history: [],
          sessionId: sc.id
        })
      });
      const text = await res.text();
      const { reply, meta, error } = parseNDJSON(text);
      
      // Save raw
      writeFileSync(`test-results/${sc.id}.txt`, text, 'utf8');
      
      if (error) {
        console.log(`  ❌ ERROR: ${error.message}`);
        results.push({ id: sc.id, msg: sc.msg, pass: false, score: 0, error: error.message });
        continue;
      }
      
      const evalResult = evaluateReply(reply, sc.msg);
      
      console.log(`  Reply(80자): "${reply.substring(0, 80)}..."`);
      console.log(`  Score: ${evalResult.score}/100`);
      evalResult.checks.forEach(c => console.log(`    ${c}`));
      
      results.push({ 
        id: sc.id, 
        msg: sc.msg, 
        pass: evalResult.score >= 70, 
        score: evalResult.score,
        escalate: meta?.escalate,
        replyPreview: reply.substring(0, 100)
      });
      
    } catch (err) {
      console.log(`  ❌ NETWORK ERROR: ${err.message}`);
      results.push({ id: sc.id, msg: sc.msg, pass: false, score: 0, error: err.message });
    }
  }
  
  // Summary
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  const avgScore = results.reduce((a, r) => a + r.score, 0) / results.length;
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 최종 평가 결과');
  console.log('='.repeat(60));
  console.log(`총 시나리오: ${results.length}`);
  console.log(`통과: ${passed} | 실패: ${failed}`);
  console.log(`평균 점수: ${avgScore.toFixed(1)}/100`);
  console.log('');
  
  results.forEach(r => {
    const icon = r.pass ? '✅' : '❌';
    console.log(`${icon} [${r.id}] (${r.score}/100): "${r.msg}"`);
    if (r.replyPreview) console.log(`     → ${r.replyPreview}`);
  });
  
  writeFileSync('test-results/_summary.json', JSON.stringify({ 
    total: results.length, passed, failed, avgScore, 
    timestamp: new Date().toISOString(),
    details: results 
  }, null, 2), 'utf8');
}

runAll().catch(console.error);
