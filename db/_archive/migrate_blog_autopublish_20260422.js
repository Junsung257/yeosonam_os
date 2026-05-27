/**
 * Blog Auto-Publish v1 마이그레이션 실행기
 *
 * 수행:
 *   1) db/blog_autopublish_v1.sql 의 모든 DDL 실행 (IF NOT EXISTS 라 재실행 안전)
 *   2) 초기 prompt_versions 레코드 seed (기존 style-guide 를 v1.0 active 로 등록)
 *   3) 초기 blog_topic_queue 확인
 *
 * 사용:
 *   node db/migrate_blog_autopublish_20260422.js
 *   DRY_RUN=true node db/migrate_blog_autopublish_20260422.js
 */

const fs = require('fs');
const path = require('path');
const { initSupabase } = require('./templates/insert-template');

const DRY_RUN = process.env.DRY_RUN === 'true';
const SQL_PATH = path.resolve(__dirname, 'blog_autopublish_v1.sql');

(async () => {
  const supabase = initSupabase();
  console.log(`[blog-autopublish-migrate] ${DRY_RUN ? '[DRY-RUN] ' : ''}시작`);

  if (DRY_RUN) {
    const sql = fs.readFileSync(SQL_PATH, 'utf-8');
    console.log('─── DDL 프리뷰 ───\n');
    console.log(sql.slice(0, 2000) + '\n... (이하 생략)\n');
    console.log('[DRY-RUN] 실제 수행 없이 종료. 재실행 시 DRY_RUN 제거.');
    return;
  }

  // 1) DDL은 수동 실행 권장 (supabase-js 는 raw SQL 제한)
  //    → Supabase SQL Editor 에서 blog_autopublish_v1.sql 내용 붙여넣기 실행
  console.log('[Step 1] DDL 은 Supabase Dashboard → SQL Editor 에서 수동 실행 필요:');
  console.log(`  경로: ${SQL_PATH}`);

  // 2) 확인 — 컬럼이 생겼는지 체크
  const { data: sample, error: sampleErr } = await supabase
    .from('content_creatives')
    .select('id, publish_scheduled_at, view_count, prompt_version')
    .limit(1);

  if (sampleErr) {
    console.error('[Step 2] 컬럼 확인 실패. DDL 실행 전일 수 있음:', sampleErr.message);
    console.error('→ Supabase Dashboard SQL Editor 에서 blog_autopublish_v1.sql 을 먼저 실행하세요.');
    process.exit(1);
  }
  console.log('[Step 2] 확장 컬럼 확인 완료.');

  // 3) 초기 prompt_versions 등록
  const { data: existing } = await supabase
    .from('prompt_versions')
    .select('id')
    .eq('domain', 'blog_style_guide')
    .eq('is_active', true)
    .limit(1);

  if (!existing || existing.length === 0) {
    const styleGuidePath = path.resolve(__dirname, '..', 'src', 'prompts', 'blog', 'style-guide.ts');
    const styleGuideContent = fs.readFileSync(styleGuidePath, 'utf-8');

    const { error: insErr } = await supabase
      .from('prompt_versions')
      .insert({
        domain: 'blog_style_guide',
        version: 'v1.0',
        content: styleGuideContent,
        change_notes: '초기 버전 — 기존 src/prompts/blog/style-guide.ts 복사',
        source: 'manual',
        is_active: true,
        activated_at: new Date().toISOString(),
      });

    if (insErr) console.warn('[Step 3] prompt_versions seed 실패:', insErr.message);
    else console.log('[Step 3] prompt_versions v1.0 활성화 등록 완료.');
  } else {
    console.log('[Step 3] prompt_versions 이미 존재 — skip.');
  }

  // 4) 큐 건수 확인
  const { count } = await supabase
    .from('blog_topic_queue')
    .select('*', { count: 'exact', head: true });
  console.log(`[Step 4] blog_topic_queue 현재 ${count ?? 0}건`);

  console.log('\n[blog-autopublish-migrate] 완료.');
})().catch((e) => {
  console.error('[blog-autopublish-migrate] 치명적 오류:', e);
  process.exit(1);
});
