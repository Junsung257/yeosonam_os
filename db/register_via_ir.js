/**
 * Phase 1.5 — IR 파이프 통합 runner (Canary 파일럿)
 *
 * /api/register-via-ir 에 POST 호출만 하는 얇은 CLI 래퍼.
 * Next.js dev 서버가 떠 있어야 한다 (http://localhost:3000).
 *
 * 사용법:
 *   node db/register_via_ir.js <raw_text_file> --operator=<랜드사> --margin=<N> [--dry-run|--insert]
 *
 * 예:
 *   node db/register_via_ir.js db/sample.txt --operator=베스트아시아 --margin=9 --dry-run
 *   node db/register_via_ir.js db/sample.txt --operator=베스트아시아 --margin=9 --insert
 */

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { file: null, operator: null, margin: null, deadline: null, dryRun: false, insert: false, base: null, engine: 'claude', irFile: null };
  for (const a of args) {
    if (a.startsWith('--operator=')) out.operator = a.slice('--operator='.length);
    else if (a.startsWith('--margin=')) out.margin = Number(a.slice('--margin='.length));
    else if (a.startsWith('--deadline=')) out.deadline = a.slice('--deadline='.length);
    else if (a.startsWith('--base=')) out.base = a.slice('--base='.length);
    else if (a.startsWith('--engine=')) out.engine = a.slice('--engine='.length);
    else if (a.startsWith('--ir=')) out.irFile = a.slice('--ir='.length);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--insert') out.insert = true;
    else if (!out.file && !a.startsWith('--')) out.file = a;
  }
  return out;
}

async function main() {
  const args = parseArgs();

  // engine=direct 는 rawText 파일 + IR JSON 파일 두 개 필요
  const isDirect = args.engine === 'direct' || args.irFile;
  if (!args.file || (!isDirect && (!args.operator || args.margin == null))) {
    console.error('사용:');
    console.error('  [claude]  node db/register_via_ir.js <raw.txt> --operator=<랜드사> --margin=<N> [--dry-run|--insert]');
    console.error('  [gemini]  node db/register_via_ir.js <raw.txt> --operator=<랜드사> --margin=<N> --engine=gemini [--dry-run|--insert]');
    console.error('  [direct]  node db/register_via_ir.js <raw.txt> --engine=direct --ir=<ir.json> [--dry-run|--insert]');
    process.exit(1);
  }
  if (!fs.existsSync(args.file)) {
    console.error(`파일 없음: ${args.file}`);
    process.exit(1);
  }
  const rawText = fs.readFileSync(args.file, 'utf-8');

  let directIr = null;
  if (isDirect) {
    if (!args.irFile || !fs.existsSync(args.irFile)) {
      console.error(`❌ --ir=<ir.json> 필요 (direct 모드)`);
      process.exit(1);
    }
    directIr = JSON.parse(fs.readFileSync(args.irFile, 'utf-8'));
  }

  const base = args.base || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const url = `${base}/api/register-via-ir`;

  console.log(`📥 원문 ${rawText.length}자 로드: ${args.file}`);
  if (isDirect) {
    console.log(`🎯 engine=direct — IR JSON 직접 전달 (LLM 호출 0원)`);
    console.log(`   IR 파일: ${args.irFile}`);
  } else {
    console.log(`📦 랜드사=${args.operator} / 마진=${args.margin}% / engine=${args.engine}`);
    console.log(`🧠 ${args.engine === 'gemini' ? 'Gemini 2.5 Flash' : 'Claude Sonnet 4.6'} 호출 시작...`);
  }
  console.log(`🌐 API: ${url}\n`);

  const started = Date.now();
  let res;
  try {
    const payload = isDirect
      ? { rawText, engine: 'direct', ir: directIr, landOperator: args.operator, commissionRate: args.margin, ticketingDeadline: args.deadline || null, dryRun: args.dryRun }
      : { rawText, engine: args.engine, landOperator: args.operator, commissionRate: args.margin, ticketingDeadline: args.deadline || null, dryRun: args.dryRun };

    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('❌ fetch 실패 — dev 서버가 떠 있는지 확인하세요:', err.message);
    process.exit(1);
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const json = await res.json().catch(() => ({}));

  if (!res.ok || !json.ok) {
    console.error(`❌ ${res.status} 실패 (${elapsed}s)`);
    console.error(JSON.stringify(json, null, 2));
    process.exit(1);
  }

  console.log(`✅ 완료 (${elapsed}s, tokens in=${json.tokensUsed?.input || 0} out=${json.tokensUsed?.output || 0})\n`);

  if (args.dryRun) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🔍 DRY-RUN 결과');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Intake ID: ${json.intakeId}`);
    console.log(`지역: ${json.ir.meta.region} (${json.ir.meta.country})`);
    console.log(`상품타입: ${json.ir.meta.productType}`);
    console.log(`일정: ${json.ir.meta.tripStyle} (${json.ir.days.length}일차)`);
    console.log(`항공: ${json.ir.meta.airline} / ${(json.ir.flights.outbound[0] || {}).code || '?'}`);
    console.log(`최소 인원: ${json.ir.meta.minParticipants}`);
    console.log(`출발일 수: ${json.ir.priceGroups.length} priceGroups`);
    console.log(`포함 토큰: ${json.ir.inclusions.length}개 (콤마 없는 개별 토큰)`);
    console.log(`호텔: ${json.ir.hotels.length}개`);
    console.log(`선택관광: ${json.ir.optionalTours.length}개`);
    console.log(`약관: manual ${json.ir.notices.manual.length}건 + auto ${json.noticesAuto}건`);
    console.log(`매칭 관광지: ${json.matchedAttractions}개`);
    console.log(`미매칭 세그먼트: ${json.unmatched.length}개`);
    if (json.unmatched.length > 0) {
      console.log('\n⚠️  미매칭 (등록 후 /admin/attractions/unmatched 에서 처리):');
      json.unmatched.slice(0, 10).forEach(u => {
        console.log(`   Day${u.dayIndex + 1}[${u.segmentIndex}] kind=${u.kind} label="${u.rawLabel || u.attractionNames.join('/')}"`);
      });
    }
    const outPath = path.join(__dirname, '..', 'scratch', `ir-${json.intakeId}.json`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(json, null, 2));
    console.log(`\n📊 전체 JSON: ${outPath}`);
  } else {
    console.log(`📦 Package: ${json.shortCode} | ${json.title}`);
    console.log(`💰 가격: ${json.price?.toLocaleString()}원`);
    console.log(`🔗 /packages/${json.packageId}`);
    console.log(`📥 미매칭 큐잉: ${json.unmatchedSegments}건`);
    console.log(`📋 자동 약관: ${json.noticesAuto}건\n`);
    console.log(`다음: post_register_audit 자동 실행 권장`);
    console.log(`  node db/post_register_audit.js ${json.packageId}`);
  }
}

main().catch(err => { console.error('💥', err); process.exit(1); });
