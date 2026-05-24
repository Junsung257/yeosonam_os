import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envContent = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const supabaseUrl = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/m)?.[1]?.trim();
const supabaseKey = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/m)?.[1]?.trim();

async function main() {
  // 발행된 블로그 글
  const res = await fetch(
    `${supabaseUrl}/rest/v1/content_creatives?select=id,slug,seo_title,seo_description,content_type,status,published_at,category_id&content_type=eq.blog&status=eq.published&order=published_at.desc.nullslast&limit=50`,
    { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
  );

  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${await res.text()}`);
    return;
  }

  let posts = await res.json();
  // content_type=blog filter may not work with JSON filter syntax, try without
  if (posts.length === 0) {
    // content_type 없이 다시 조회
    const res2 = await fetch(
      `${supabaseUrl}/rest/v1/content_creatives?select=id,slug,seo_title,content_type,status,published_at&order=published_at.desc.nullslast&limit=50`,
      { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
    );
    posts = await res2.json();
  }

  console.log('=== 발행된 블로그 글 ===');
  console.log('총', posts.length, '개\n');

  for (const post of posts) {
    if (post.status !== 'published') continue;
    console.log('---');
    console.log('ID:', post.id);
    console.log('제목:', post.seo_title || post.title || '(제목 없음)');
    console.log('슬러그:', post.slug);
    console.log('타입:', post.content_type);
    console.log('발행일:', post.published_at || '(없음)');
    console.log('URL: https://yeosonam.com/blog/' + post.slug);
    console.log('');
  }
}

main().catch(console.error);
