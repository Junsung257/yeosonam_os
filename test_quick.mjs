const BASE = 'http://localhost:3000';

async function test(msg) {
  const r = await fetch(`${BASE}/api/qa/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg }),
  });
  const t = await r.text();
  let reply = '';
  for (const line of t.split('\n').filter(l => l.trim())) {
    try {
      const ev = JSON.parse(line);
      if (ev.type === 'text' && ev.content) reply += ev.content;
      else if (ev.type === 'text_final' && ev.content) reply += ev.content;
    } catch (e) {}
  }
  return reply;
}

async function main() {
  console.log('=== 테스트 1: 다낭 6월 특가 ===');
  const r1 = await test('다낭 6월 특가 알려줘');
  console.log(r1);
  console.log('\n--- 체크 ---');
  console.log('BX:', r1.includes('BX'), 'LJ:', r1.includes('LJ'));
  console.log('---:', r1.includes('---'));
  console.log('링크:', (r1.match(/\/packages\//g) || []).length);
  console.log('이모지💰:', r1.includes('💰'), '🏨:', r1.includes('🏨'), '✈️:', r1.includes('✈️'));
  console.log('에어부산:', r1.includes('에어부산'));
  console.log('줄수:', r1.split('\n').length);
  console.log('마지막줄:', r1.trim().split('\n').pop());

  console.log('\n=== 테스트 2: 제주도 ===');
  const r2 = await test('제주도 패키지 추천해줘');
  console.log(r2.substring(0, 300));
  const last100 = r2.slice(-100);
  console.log('\n마지막 100자:', last100);
  console.log('부정종결:', /없습니다|없어요/.test(last100) ? '🚨 위험' : '✅ 안전');

  console.log('\n=== 테스트 3: 다낭 4박6일 ===');
  const r3 = await test('다낭 4박 6일 패키지 알려줘');
  console.log(r3.substring(0, 300));
  const last100_3 = r3.slice(-100);
  console.log('\n마지막 100자:', last100_3);
  console.log('부정종결:', /없습니다|없어요/.test(last100_3) ? '🚨 위험' : '✅ 안전');

  console.log('\n=== 테스트 4: 가족여행 ===');
  const r4 = await test('가족끼리 가기 좋은 동남아 패키지 추천해줘');
  console.log(r4.substring(0, 300));
}

main().catch(console.error);
