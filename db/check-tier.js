/**
 * 지역별 어셈블러 현황 확인 CLI
 *
 * 사용법:
 *   node db/check-tier.js          # 전체 지역 조회
 *   node db/check-tier.js 라오스    # 특정 지역 조회
 */

const fs = require('fs');
const path = require('path');

const DB_DIR = path.resolve(__dirname);

// 지역 코드 매핑 (register.md와 동기화)
const REGIONS = {
  '서안': 'xian', '칭다오': 'qingdao', '장가계': 'zhangjiajie',
  '나트랑': 'nhatrang', '라오스': 'laos', '몽골': 'mongolia',
  '다낭': 'danang', '하노이': 'hanoi', '보홀': 'bohol',
  '후쿠오카': 'fukuoka', '달랏': 'dalat', '마카오': 'macau',
  '방콕': 'bangkok', '세부': 'cebu', '발리': 'bali',
  '호치민': 'hochiminh', '푸꾸옥': 'phuquoc', '치앙마이': 'chiangmai',
};

function checkRegion(name) {
  const code = REGIONS[name];
  if (!code) {
    console.log(`\n${name} — 미등록 지역 (어셈블러 없음)`);
    console.log(`  → /register로 첫 등록 시 자동 생성됩니다.\n`);
    return;
  }

  const assemblerPath = path.join(DB_DIR, `assembler_${code}.js`);
  const exists = fs.existsSync(assemblerPath);

  if (exists) {
    const stat = fs.statSync(assemblerPath);
    const lines = fs.readFileSync(assemblerPath, 'utf-8').split('\n').length;

    // BLOCKS 수 추출
    const content = fs.readFileSync(assemblerPath, 'utf-8');
    const blockMatches = content.match(/code:\s*'[A-Z]+-[A-Z0-9]+'/g) || [];

    console.log(`\n${name} (${code}) — 어셈블러 있음`);
    console.log(`  파일: db/assembler_${code}.js (${lines}줄, ${(stat.size / 1024).toFixed(1)}KB)`);
    console.log(`  블록: ${blockMatches.length}개`);
    console.log(`  토큰: ~1,500/상품 (CLI 실행만)\n`);
  } else {
    console.log(`\n${name} (${code}) — 어셈블러 없음`);
    console.log(`  토큰: ~30,000/상품 (Claude 직접 구성)`);
    console.log(`  → /register로 첫 등록 시 자동 생성됩니다.\n`);
  }
}

function listAll() {
  console.log('\n=== 전체 지역 어셈블러 현황 ===\n');

  const withAssembler = [];
  const withoutAssembler = [];

  for (const [name, code] of Object.entries(REGIONS)) {
    const assemblerPath = path.join(DB_DIR, `assembler_${code}.js`);
    if (fs.existsSync(assemblerPath)) {
      const content = fs.readFileSync(assemblerPath, 'utf-8');
      const blockMatches = content.match(/code:\s*'[A-Z]+-[A-Z0-9]+'/g) || [];
      withAssembler.push({ name, code, blocks: blockMatches.length });
    } else {
      withoutAssembler.push({ name, code });
    }
  }

  if (withAssembler.length > 0) {
    console.log('  어셈블러 있음 (~1,500 토큰/상품):');
    withAssembler.forEach(r => {
      console.log(`    ${r.name.padEnd(8)} | assembler_${r.code}.js | 블록 ${r.blocks}개`);
    });
  }

  if (withoutAssembler.length > 0) {
    console.log('\n  어셈블러 없음 (~30,000 토큰/첫 등록, 이후 ~1,500):');
    withoutAssembler.forEach(r => {
      console.log(`    ${r.name.padEnd(8)} | 첫 등록 시 자동 생성`);
    });
  }

  // db/ 디렉토리에서 매핑에 없는 어셈블러 파일도 표시
  const allAssemblers = fs.readdirSync(DB_DIR).filter(f => f.startsWith('assembler_') && f.endsWith('.js'));
  const knownCodes = new Set(Object.values(REGIONS).map(c => `assembler_${c}.js`));
  const unknown = allAssemblers.filter(f => !knownCodes.has(f));
  if (unknown.length > 0) {
    console.log('\n  기타 어셈블러:');
    unknown.forEach(f => console.log(`    ${f}`));
  }

  console.log('');
}

// ── MAIN ──
const arg = process.argv[2];
if (arg) {
  checkRegion(arg);
} else {
  listAll();
}
