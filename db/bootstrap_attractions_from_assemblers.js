/**
 * Phase 1.5 — 신규 지역 부트스트랩: 어셈블러 BLOCKS → attractions 초기 시드
 *
 * IR 파이프의 "관광지 lookup 닭과 달걀" 문제 해결:
 *   어셈블러(assembler_xian.js / assembler_qingdao.js / assembler_danang.js)는 이미
 *   지역별 대표 관광지 리스트를 BLOCKS 배열에 내장 — 이 데이터를 attractions 테이블로
 *   1회 시드하여 신규 지역 첫 등록 시에도 lookup 성공률 확보.
 *
 * 원칙:
 *   - ERR-20260418-33 (관광지 자동 시드 금지) 메타 규칙을 **어기지 않음**:
 *     자동 LLM 설명 생성 X / 사진 자동 수집 X / 어드민 승인 전 published=false
 *   - 어셈블러에 이미 있는 **이름 + keywords + short_desc 스텁만** 시드
 *   - 사장님이 /admin/attractions/unmatched 에서 후처리 (설명 보완 + 사진 업로드)
 *
 * 사용법:
 *   node db/bootstrap_attractions_from_assemblers.js --region=황산 --dry-run
 *   node db/bootstrap_attractions_from_assemblers.js --region=all --insert
 */

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { region: null, dryRun: false, insert: false };
  for (const a of args) {
    if (a.startsWith('--region=')) out.region = a.slice('--region='.length);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--insert') out.insert = true;
  }
  return out;
}

function loadAssemblerBlocks(filePath) {
  const src = fs.readFileSync(filePath, 'utf-8');
  // BLOCKS 배열 파싱 (간이 정규식 — 정확한 파싱 아니라 발췌)
  const blocksMatch = src.match(/const BLOCKS\s*=\s*\[([\s\S]*?)\];/);
  if (!blocksMatch) return [];
  const body = blocksMatch[1];
  const blocks = [];
  const re = /\{\s*code:\s*'([^']+)'[^}]*?name:\s*'([^']+)'[^}]*?keywords:\s*\[([^\]]+)\][^}]*?(?:short_desc:\s*'([^']*)')?[^}]*?(?:badge_type:\s*'([^']*)')?[^}]*?\}/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const keywords = m[3].split(',').map(s => s.replace(/['"]/g, '').trim()).filter(Boolean);
    blocks.push({
      code: m[1],
      name: m[2],
      keywords,
      short_desc: m[4] || null,
      badge_type: m[5] || 'tour',
    });
  }
  return blocks;
}

const REGION_FILES = {
  '서안': { file: 'db/assembler_xian.js', country: '중국' },
  '칭다오': { file: 'db/assembler_qingdao.js', country: '중국' },
  '다낭': { file: 'db/assembler_danang.js', country: '베트남' },
};

async function main() {
  const args = parseArgs();
  if (!args.region) {
    console.error('사용: node db/bootstrap_attractions_from_assemblers.js --region=<지역|all> [--dry-run|--insert]');
    console.error('지원 지역:', Object.keys(REGION_FILES).join(', '));
    process.exit(1);
  }

  const targets = args.region === 'all' ? Object.keys(REGION_FILES) : [args.region];
  const invalid = targets.filter(r => !REGION_FILES[r]);
  if (invalid.length > 0) {
    console.error(`❌ 지원하지 않는 지역: ${invalid.join(', ')}`);
    process.exit(1);
  }

  const { createClient } = require('@supabase/supabase-js');
  const envFile = fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf-8');
  const env = {};
  envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  let totalNew = 0;
  let totalExisting = 0;

  for (const region of targets) {
    const { file, country } = REGION_FILES[region];
    const absPath = path.resolve(__dirname, '..', file);
    if (!fs.existsSync(absPath)) {
      console.log(`⏭️  ${region}: 어셈블러 없음 (${file}) — 스킵`);
      continue;
    }
    const blocks = loadAssemblerBlocks(absPath);
    console.log(`\n📂 ${region} (${file}) — ${blocks.length}개 블록 발견`);

    if (blocks.length === 0) continue;

    // 이미 있는 attractions 이름 조회
    const { data: existing } = await sb
      .from('attractions')
      .select('name, aliases')
      .or(`region.eq.${region},country.eq.${country}`);
    const existingNames = new Set(
      (existing || []).flatMap(a => [a.name, ...(a.aliases || [])].map(n => n.toLowerCase().trim())),
    );

    const toInsert = [];
    for (const b of blocks) {
      const lower = b.name.toLowerCase().trim();
      if (existingNames.has(lower)) {
        totalExisting++;
        continue;
      }
      toInsert.push({
        name: b.name,
        short_desc: b.short_desc || null,
        long_desc: null, // 사장님이 /admin/attractions 에서 보완
        country,
        region,
        badge_type: b.badge_type || 'tour',
        aliases: b.keywords,
        is_active: true,
      });
    }

    console.log(`   기존 매칭: ${blocks.length - toInsert.length}개`);
    console.log(`   신규 시드 대상: ${toInsert.length}개`);

    if (args.dryRun) {
      console.log(`   (dry-run) 첫 5개: ${toInsert.slice(0, 5).map(a => a.name).join(', ')}`);
      continue;
    }
    if (!args.insert) continue;

    if (toInsert.length > 0) {
      const { error } = await sb.from('attractions').insert(toInsert);
      if (error) {
        console.error(`   ❌ INSERT 실패: ${error.message}`);
      } else {
        console.log(`   ✅ ${toInsert.length}개 시드 완료 (short_desc/long_desc/photos 는 /admin/attractions 에서 보완 필요)`);
        totalNew += toInsert.length;
      }
    }
  }

  console.log(`\n📊 요약: 신규 ${totalNew}개 시드 / 기존 매칭 ${totalExisting}개`);
  if (totalNew > 0) {
    console.log(`\n다음 단계:`);
    console.log(`  1) /admin/attractions 에서 시드된 관광지 long_desc·사진 보완`);
    console.log(`  2) /admin/attractions 의 Pexels 일괄 자동 수집 기능 활용`);
  }
}

main().catch(err => { console.error('💥', err); process.exit(1); });
