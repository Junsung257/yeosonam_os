/**
 * 네이버 검색광고 API 실제 동작 테스트
 * 
 * 실행: node scripts/test-naver-ads-api.mjs
 *
 * 필요한 환경 변수 (.env.local):
 *   NAVER_ADS_API_KEY
 *   NAVER_ADS_SECRET_KEY
 *   NAVER_ADS_CUSTOMER_ID
 */
import { createHmac } from 'crypto';

// .env.local 직접 로드
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf-8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  let value = trimmed.slice(eqIdx + 1).trim();
  // 따옴표 제거
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  env[key] = value;
}

const API_KEY = env['NAVER_ADS_API_KEY'];
const SECRET_KEY = env['NAVER_ADS_SECRET_KEY'];
const CUSTOMER_ID = env['NAVER_ADS_CUSTOMER_ID'];

console.log('=== 네이버 검색광고 API 테스트 ===');
console.log('');

if (!API_KEY || !SECRET_KEY || !CUSTOMER_ID) {
  console.error('❌ 환경 변수 누락:');
  console.error(`   API_KEY: ${API_KEY ? '✅' : '❌'}`);
  console.error(`   SECRET_KEY: ${SECRET_KEY ? '✅' : '❌'}`);
  console.error(`   CUSTOMER_ID: ${CUSTOMER_ID ? '✅' : '❌'}`);
  process.exit(1);
}

console.log(`✅ API_KEY: ${API_KEY.slice(0, 8)}...`);
console.log(`✅ SECRET_KEY: ${SECRET_KEY.slice(0, 8)}...`);
console.log(`✅ CUSTOMER_ID: ${CUSTOMER_ID}`);
console.log('');

// ─── TEST 1: 키워드 검색 (keywordstool) ─────────────────────
async function testKeywordTool() {
  console.log('─── Test 1: 키워드 검색 (keywordstool) ───');
  
  const method = 'GET';
  const path = '/keywordstool';
  const timestamp = Date.now().toString();
  const signature = createHmac('sha256', SECRET_KEY)
    .update(`${timestamp}.${method}.${path}`)
    .digest('base64');

  const headers = {
    'X-Timestamp': timestamp,
    'X-API-KEY': API_KEY,
    'X-Customer': CUSTOMER_ID,
    'X-Signature': signature,
    'Content-Type': 'application/json;charset=UTF-8',
  };

  const url = `https://api.searchad.naver.com${path}?hintKeywords=여행&showDetail=1`;

  try {
    const res = await fetch(url, { method, headers });
    console.log(`   HTTP ${res.status}`);
    
    if (res.ok) {
      const data = await res.json();
      const keywordCount = data?.keywordList?.length ?? 0;
      console.log(`   ✅ 성공! 키워드 ${keywordCount}개 조회됨`);
      if (keywordCount > 0) {
        console.log('   첫 3개 키워드:');
        data.keywordList.slice(0, 3).forEach((k, i) => {
          console.log(`     ${i + 1}. ${k.relKeyword} (월검색량: ${k.monthlyPcQcCnt + k.monthlyMobileQcCnt})`);
        });
      }
      return true;
    } else {
      const text = await res.text();
      console.log(`   ❌ 실패: ${text.slice(0, 300)}`);
      return false;
    }
  } catch (err) {
    console.log(`   ❌ 오류: ${err.message}`);
    return false;
  }
}

// ─── TEST 2: 캠페인 목록 조회 ─────────────────────
async function testCampaignList() {
  console.log('');
  console.log('─── Test 2: 캠페인 목록 조회 ───');
  
  const method = 'GET';
  const path = `/ncc/campaigns`;
  const timestamp = Date.now().toString();
  const signature = createHmac('sha256', SECRET_KEY)
    .update(`${timestamp}.${method}.${path}`)
    .digest('base64');

  const headers = {
    'X-Timestamp': timestamp,
    'X-API-KEY': API_KEY,
    'X-Customer': CUSTOMER_ID,
    'X-Signature': signature,
    'Content-Type': 'application/json;charset=UTF-8',
  };

  const url = `https://api.searchad.naver.com${path}`;

  try {
    const res = await fetch(url, { method, headers });
    console.log(`   HTTP ${res.status}`);
    
    if (res.ok) {
      const data = await res.json();
      const count = Array.isArray(data) ? data.length : 0;
      console.log(`   ✅ 성공! 캠페인 ${count}개 조회됨`);
      if (count > 0) {
        console.log('   캠페인 목록:');
        data.slice(0, 5).forEach((c, i) => {
          console.log(`     ${i + 1}. ${c.name} (ID: ${c.nccCampaignId}, 상태: ${c.status})`);
        });
      }
      return data;
    } else {
      const text = await res.text();
      console.log(`   ❌ 실패: ${text.slice(0, 300)}`);
      return null;
    }
  } catch (err) {
    console.log(`   ❌ 오류: ${err.message}`);
    return null;
  }
}

// ─── TEST 3: 스탯 조회 ─────────────────────
async function testStats() {
  console.log('');
  console.log('─── Test 3: 스탯 조회 (캠페인별) ───');
  
  const campaigns = await testCampaignList();
  if (!campaigns || campaigns.length === 0) {
    console.log('   ⏭️ 캠페인 없음 — 스탯 테스트 생략');
    return false;
  }

  const campaignId = campaigns[0].nccCampaignId;
  const method = 'GET';
  const path = `/stats`;
  const timestamp = Date.now().toString();
  const signature = createHmac('sha256', SECRET_KEY)
    .update(`${timestamp}.${method}.${path}`)
    .digest('base64');

  const headers = {
    'X-Timestamp': timestamp,
    'X-API-KEY': API_KEY,
    'X-Customer': CUSTOMER_ID,
    'X-Signature': signature,
    'Content-Type': 'application/json;charset=UTF-8',
  };

  const params = new URLSearchParams({
    ids: JSON.stringify([campaignId]),
    fields: JSON.stringify(['impCnt', 'clkCnt', 'ctr', 'cpc', 'salesAmt', 'ccnt']),
    datePreset: 'last30days',
  });

  const url = `https://api.searchad.naver.com${path}?${params.toString()}`;

  try {
    const res = await fetch(url, { method, headers });
    console.log(`   HTTP ${res.status}`);
    
    if (res.ok) {
      const data = await res.json();
      console.log(`   ✅ 성공! 스탯 조회됨`);
      console.log(`   데이터:`, JSON.stringify(data).slice(0, 300));
      return true;
    } else {
      const text = await res.text();
      console.log(`   ❌ 실패: ${text.slice(0, 300)}`);
      return false;
    }
  } catch (err) {
    console.log(`   ❌ 오류: ${err.message}`);
    return false;
  }
}

// 실행
async function main() {
  const results = [];
  
  results.push({ test: '키워드 검색 (keywordstool)', passed: await testKeywordTool() });
  results.push({ test: '스탯 조회', passed: await testStats() });

  console.log('');
  console.log('=== 결과 요약 ===');
  for (const r of results) {
    console.log(`   ${r.passed ? '✅' : '❌'} ${r.test}`);
  }
  
  if (results.some(r => r.passed)) {
    console.log('\n✅ 일부 API 호출 성공! 코드 연동 정상 동작 확인됨.');
  } else {
    console.log('\n❌ 모든 API 호출 실패. API 키 확인 필요.');
  }
}

main().catch(console.error);
