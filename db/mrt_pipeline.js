#!/usr/bin/env node
/**
 * db/mrt_pipeline.js
 *
 * MRT 데이터 전체 자동화 파이프라인 (알아서 끝까지 실행)
 *
 *   STEP 1: 전체 도시 sync (이름/평점/이미지) ← sync_mrt_attractions.js --all
 *   STEP 2: 우선순위 도시 설명 수집              ← sync_mrt_attractions.js --city X --with-desc
 *   STEP 3: AI 재작성 (DeepSeek)               ← process_mrt_descriptions.js
 *
 * 사용법:
 *   node db/mrt_pipeline.js                    # 전체 실행 (신규/미처리만)
 *   node db/mrt_pipeline.js --skip-sync        # STEP 1 스킵 (이미 sync된 경우)
 *   node db/mrt_pipeline.js --skip-ai          # STEP 3 스킵 (DeepSeek 호출 안 함)
 *   node db/mrt_pipeline.js --dry-run          # 저장 없이 출력만
 */

const { execSync, spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const DRY_RUN   = args.includes('--dry-run');
const SKIP_SYNC = args.includes('--skip-sync');
const SKIP_AI   = args.includes('--skip-ai');

// STEP 2: 설명 수집 우선순위 도시 (실제 상품 판매 중인 지역 우선)
const DESC_PRIORITY_CITIES = [
  '장가계', '서안', '북경', '상해', '칭다오', '하이난',
  '청두', '구채구', '리장', '계림', '황산',
  '다낭', '나트랑', '하노이', '호치민', '푸꾸옥',
  '방콕', '파타야', '치앙마이', '푸켓',
  '발리', '세부', '싱가포르', '코타키나발루',
  '두바이', '터키', '이집트', '오만',
  '도쿄', '오사카', '후쿠오카', '오키나와',
  '몰디브', '몽골', '우즈베키스탄',
];

// STEP 3: AI 재작성 배치 크기
const AI_BATCH_LIMIT = 300;

// ─── 유틸 ──────────────────────────────────────────────────────────────────

function run(cmd, label) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`▶ ${label}`);
  console.log(`  ${cmd}`);
  console.log('─'.repeat(60));
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', shell: true });
}

function section(title) {
  const bar = '═'.repeat(60);
  console.log(`\n${bar}`);
  console.log(`  ${title}`);
  console.log(bar);
}

// ─── 메인 ──────────────────────────────────────────────────────────────────

async function main() {
  const startAt = Date.now();
  console.log('\n🚀 MRT 전체 파이프라인 시작');
  console.log(`   모드: ${DRY_RUN ? 'DRY RUN' : '실제 저장'} | SYNC: ${SKIP_SYNC ? 'SKIP' : 'ON'} | AI: ${SKIP_AI ? 'SKIP' : 'ON'}`);

  // ── STEP 1: 전체 도시 sync ──────────────────────────────────────
  if (!SKIP_SYNC) {
    section('STEP 1/3 — 전체 도시 기본 sync (이름/평점/이미지)');
    run(
      `node db/sync_mrt_attractions.js --all${DRY_RUN ? ' --dry-run' : ''}`,
      '전체 도시 sync'
    );
  } else {
    section('STEP 1/3 — SKIP (--skip-sync)');
  }

  // ── STEP 2: 우선순위 도시 설명 수집 ─────────────────────────────
  section('STEP 2/3 — 우선순위 도시 설명 수집 (mrt_raw_desc)');
  for (const city of DESC_PRIORITY_CITIES) {
    try {
      run(
        `node db/sync_mrt_attractions.js --city ${city} --with-desc${DRY_RUN ? ' --dry-run' : ''}`,
        `설명 수집: ${city}`
      );
    } catch (e) {
      console.error(`  [경고] ${city} 설명 수집 실패, 계속 진행`);
    }
  }

  // ── STEP 3: AI 재작성 ───────────────────────────────────────────
  if (!SKIP_AI) {
    section('STEP 3/3 — DeepSeek AI 재작성 (long_desc / short_desc)');
    run(
      `node db/process_mrt_descriptions.js --limit ${AI_BATCH_LIMIT}${DRY_RUN ? ' --dry-run' : ''}`,
      `AI 재작성 (최대 ${AI_BATCH_LIMIT}건)`
    );
  } else {
    section('STEP 3/3 — SKIP (--skip-ai)');
  }

  const elapsed = Math.round((Date.now() - startAt) / 1000);
  const hh = Math.floor(elapsed / 3600);
  const mm = Math.floor((elapsed % 3600) / 60);
  const ss = elapsed % 60;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`✅ 파이프라인 완료 — 소요: ${hh ? hh + 'h ' : ''}${mm ? mm + 'm ' : ''}${ss}s`);
  console.log('═'.repeat(60));
}

main().catch(err => {
  console.error('\n[치명적 오류]', err.message);
  process.exit(1);
});
