/**
 * Blog seo_title 접미사 정리 — "| 여소남 YYYY" 중복 표기 제거
 *
 * 배경:
 *   - 이전 generateBlogSeo 는 seo_title 말미에 " | 여소남 2026" 을 직접 붙였다.
 *   - src/app/layout.tsx 의 metadata.template ("%s | 여소남") 이 자동으로 한 번 더
 *     "| 여소남" 을 붙이면서 실제 <title> 이 "… | 여소남 2026 | 여소남" 으로 찍혔다.
 *   - 프론트(src/app/blog/[slug]/page.tsx) 는 런타임에 접미사를 제거하지만,
 *     OG/네이버/구글 캐시 품질을 위해 DB 값 자체도 정리한다.
 *
 * 대상:
 *   content_creatives.seo_title 말미의 정규식 /\s*\|\s*여소남(\s*\d{4})?\s*$/g 를 제거.
 *
 * 환경변수:
 *   DRY_RUN=true  — 변경 대상만 출력하고 UPDATE 수행하지 않음.
 *   LIMIT=N       — 상위 N개만 처리 (테스트용).
 */

const { initSupabase } = require('./templates/insert-template');

const SUFFIX_RE = /\s*\|\s*여소남(\s*\d{4})?\s*$/;
const DRY_RUN = process.env.DRY_RUN === 'true';
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : null;

(async () => {
  const supabase = initSupabase();

  console.log(`[migrate_blog_seo_titles] ${DRY_RUN ? '[DRY-RUN] ' : ''}시작`);

  let query = supabase
    .from('content_creatives')
    .select('id, slug, seo_title')
    .eq('channel', 'naver_blog')
    .not('slug', 'is', null)
    .not('seo_title', 'is', null);

  if (LIMIT) query = query.limit(LIMIT);

  const { data, error } = await query;
  if (error) {
    console.error('[migrate_blog_seo_titles] SELECT 실패:', error);
    process.exit(1);
  }

  const candidates = (data || []).filter((row) => SUFFIX_RE.test(row.seo_title || ''));

  console.log(`[migrate_blog_seo_titles] 전체 ${data?.length ?? 0}편 중 접미사 제거 대상 ${candidates.length}편`);

  if (candidates.length === 0) {
    console.log('[migrate_blog_seo_titles] 변경 대상 없음 — 종료');
    return;
  }

  let updated = 0;
  let failed = 0;

  for (const row of candidates) {
    const before = row.seo_title || '';
    const after = before.replace(SUFFIX_RE, '').trim();

    // 방어: 잘라낸 뒤 빈 문자열이 되면 스킵
    if (!after) {
      console.warn(`[skip] ${row.slug}: cleaned title is empty (before="${before}")`);
      continue;
    }
    if (after === before) continue;

    console.log(`  - ${row.slug}`);
    console.log(`    before: ${before}`);
    console.log(`    after : ${after}`);

    if (DRY_RUN) continue;

    const { error: upErr } = await supabase
      .from('content_creatives')
      .update({ seo_title: after })
      .eq('id', row.id);

    if (upErr) {
      console.error(`    ✗ UPDATE 실패:`, upErr.message);
      failed++;
    } else {
      updated++;
    }
  }

  console.log(`\n[migrate_blog_seo_titles] 완료 · updated=${updated} failed=${failed} dryRun=${DRY_RUN}`);

  if (!DRY_RUN && updated > 0) {
    console.log(
      `\n↻ ISR 캐시 무효화 권장:\n` +
        `  curl -X POST "$NEXT_PUBLIC_BASE_URL/api/revalidate" ` +
        `-H "Content-Type: application/json" ` +
        `-d '{"paths":["/blog"], "secret":"$REVALIDATE_SECRET"}'`,
    );
  }
})().catch((e) => {
  console.error('[migrate_blog_seo_titles] 치명적 오류:', e);
  process.exit(1);
});
