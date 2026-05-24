/**
 * 네이버 IndexNow 대량 전송 스크립트
 *
 * 기존 블로그 글 전부를 네이버 IndexNow 엔드포인트에 POST로 제출합니다.
 * 한 번에 최대 10,000 URL까지 가능하므로 모든 글을 한 번에 보냅니다.
 *
 * 사용법: node scripts/notify-naver-indexnow.mjs
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// .env.local 로드
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const INDEXNOW_KEY = process.env.INDEXNOW_KEY;
const BASE_URL = 'https://www.yeosonam.com';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ SUPABASE_URL 또는 SUPABASE_KEY가 설정되지 않았습니다.');
  process.exit(1);
}
if (!INDEXNOW_KEY) {
  console.error('❌ INDEXNOW_KEY가 설정되지 않았습니다.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fetchBlogUrls() {
  console.log('📡 Supabase에서 블로그 글 목록 조회 중...');

  // content_type이 blog/guide/pillar 등 모두 포함, published 상태
  const { data, error } = await supabase
    .from('content_creatives')
    .select('slug')
    .eq('status', 'published')
    .not('slug', 'is', null);

  if (error) {
    console.error('❌ Supabase 조회 실패:', error.message);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log('⚠️ 발행된 블로그 글이 없습니다.');
    return [];
  }

  const urls = data.map(row => `${BASE_URL}/blog/${row.slug}`);
  console.log(`✅ ${urls.length}개 URL 조회 완료`);
  return urls;
}

async function submitToNaverIndexNow(urls) {
  if (urls.length === 0) {
    console.log('⚠️ 제출할 URL이 없습니다.');
    return;
  }

  console.log(`\n📤 네이버 IndexNow에 ${urls.length}개 URL 전송 중...`);
  console.log(`   호스트: ${new URL(BASE_URL).host}`);
  console.log(`   key: ${INDEXNOW_KEY}`);
  console.log(`   keyLocation: ${BASE_URL}/${INDEXNOW_KEY}.txt\n`);

  const payload = {
    host: new URL(BASE_URL).host,
    key: INDEXNOW_KEY,
    keyLocation: `${BASE_URL}/${INDEXNOW_KEY}.txt`,
    urlList: urls,
  };

  try {
    const res = await fetch('https://searchadvisor.naver.com/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    console.log(`📋 응답 코드: ${res.status} ${res.statusText}`);

    if (res.status === 200) {
      console.log('✅ 네이버 IndexNow 전송 성공! (200 Success)');
    } else if (res.status === 202) {
      console.log('✅ 네이버 IndexNow 수신 완료! (202 Accepted — 키 인증 대기 중)');
    } else if (res.status === 429) {
      console.log('⚠️ 요청 한도 초과 (429 Too Many Requests) — 잠시 후 다시 시도하세요.');
    } else if (res.status === 403) {
      console.log('❌ key가 유효하지 않습니다 (403 Forbidden)');
    } else if (res.status === 422) {
      console.log('❌ URL이 key 정보와 일치하지 않습니다 (422 Unprocessable Entity)');
    } else {
      const text = await res.text().catch(() => '(응답 본문 없음)');
      console.log(`⚠️ 예상치 못한 응답: ${text}`);
    }

    return res.status;
  } catch (err) {
    console.error('❌ 네트워크 오류:', err.message);
    throw err;
  }
}

async function main() {
  console.log('=== 네이버 IndexNow 대량 전송 ===\n');

  const urls = await fetchBlogUrls();

  // 글로벌 IndexNow(api.indexnow.org)로도 같이 전송 (Bing/Yandex/Seznam)
  if (urls.length > 0) {
    console.log('\n📤 글로벌 IndexNow(api.indexnow.org)에도 함께 전송합니다...');
    try {
      const globalPayload = {
        host: new URL(BASE_URL).host,
        key: INDEXNOW_KEY,
        keyLocation: `${BASE_URL}/${INDEXNOW_KEY}.txt`,
        urlList: urls,
      };
      const globalRes = await fetch('https://api.indexnow.org/indexnow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(globalPayload),
      });
      console.log(`   ✅ 글로벌 IndexNow 응답: ${globalRes.status} ${globalRes.statusText}`);
    } catch (err) {
      console.log(`   ❌ 글로벌 IndexNow 실패: ${err.message} (무시, 네이버는 계속 진행)`);
    }

    await submitToNaverIndexNow(urls);
  }

  console.log('\n=== 완료 ===');
}

main().catch(err => {
  console.error('\n❌ 스크립트 실행 중 오류:', err);
  process.exit(1);
});
