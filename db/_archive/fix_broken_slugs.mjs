/**
 * 깨진 slug 발견 및 복구 스크립트
 * 
 * DB의 content_creatives 테이블에서 비정상적인 문자(치환문자 \uFFFD)가 포함된
 * slug를 찾아내고 복구한다.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

function loadEnv() {
  const envPath = resolve('.env.local');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('SUPABASE 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  console.log('=== 깨진 slug 검사 ===\n');

  // 1) 모든 published 블로그 slug 조회
  const { data, error } = await supabase
    .from('content_creatives')
    .select('id, slug, seo_title, status, channel')
    .eq('channel', 'naver_blog')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('쿼리 실패:', error);
    return;
  }

  console.log(`총 ${data.length}개 레코드 (channel=naver_blog)\n`);

  // 2) 치환문자(\uFFFD) 또는 비정상 slug 찾기
  const brokenSlugs = data.filter(r => r.slug && r.slug.includes('\uFFFD'));
  const emptySlug = data.filter(r => !r.slug);
  
  if (brokenSlugs.length > 0) {
    console.log(`=== 치환문자(\\uFFFD) 포함 slug: ${brokenSlugs.length}개 ===`);
    for (const r of brokenSlugs) {
      console.log(`  ID: ${r.id}`);
      console.log(`  Slug: "${r.slug}"`);
      console.log(`  제목: ${r.seo_title || '(없음)'}`);
      console.log(`  상태: ${r.status}`);
      console.log('');
    }
  }

  if (emptySlug.length > 0) {
    console.log(`=== slug가 NULL인 레코드: ${emptySlug.length}개 ===`);
    for (const r of emptySlug) {
      console.log(`  ID: ${r.id}, 제목: ${r.seo_title || '(없음)'}, 상태: ${r.status}`);
    }
    console.log('');
  }

  // 3) 통계
  const byStatus = {};
  for (const r of data) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  }
  console.log('=== 상태별 통계 ===');
  for (const [status, count] of Object.entries(byStatus)) {
    console.log(`  ${status}: ${count}개`);
  }
  console.log(`\n=== 깨진 slug ${brokenSlugs.length}개 발견 ===`);
  
  if (brokenSlugs.length > 0) {
    console.log('\n※ 복구 방법 (수동):');
    console.log('  UPDATE content_creatives');
    console.log(`  SET slug = '올바른-slug-값'`);
    console.log(`  WHERE id = '${brokenSlugs[0]?.id}';`);
    console.log('\n또는 해당 글을 재발행하면 slug가 새로 생성됩니다.');
  }
}

main().catch(console.error);
