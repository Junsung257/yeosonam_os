/**
 * destination 인프라 셋업
 * 1. Supabase Storage 버킷 "destination-photos" 생성 (Public Read)
 * 2. destination_metadata 테이블 존재 여부 확인 → 없으면 SQL 출력
 *
 * 실행: node db/setup_destination_infra.js
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ── env 로드 ──────────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '..', '.env.local');
const env = {};
fs.readFileSync(envPath, 'utf-8').split('\n').forEach(l => {
  const [k, ...v] = l.split('=');
  if (k && v.length) env[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '');
});

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

async function main() {
  console.log('\n🚀 destination 인프라 셋업 시작\n');

  // ── 1. Storage 버킷 생성 ───────────────────────────────────────────────
  console.log('📦 [1/3] Storage 버킷 "destination-photos" 생성...');
  const { data: bucketData, error: bucketErr } = await sb.storage.createBucket('destination-photos', {
    public: true,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    fileSizeLimit: 10 * 1024 * 1024, // 10MB
  });

  if (bucketErr) {
    if (bucketErr.message?.includes('already exists') || bucketErr.message?.includes('Duplicate')) {
      console.log('  ✅ 버킷 이미 존재 (정상)');
    } else {
      console.error('  ❌ 버킷 생성 실패:', bucketErr.message);
    }
  } else {
    console.log('  ✅ 버킷 생성 완료:', bucketData?.name);
  }

  // ── 2. destination_metadata 테이블 존재 확인 ───────────────────────────
  console.log('\n📋 [2/3] destination_metadata 테이블 확인...');
  const { error: tableErr } = await sb
    .from('destination_metadata')
    .select('destination')
    .limit(1);

  if (!tableErr) {
    console.log('  ✅ 테이블 이미 존재');
  } else if (tableErr.code === '42P01' || tableErr.message?.includes('does not exist')) {
    console.log('  ⚠️  테이블 미존재 — 아래 SQL을 Supabase Dashboard > SQL Editor에서 실행하세요:');
    const sqlPath = path.join(__dirname, 'destination_metadata_v1.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    console.log('\n' + '─'.repeat(60));
    console.log(sql);
    console.log('─'.repeat(60) + '\n');
    console.log('  또는 Claude Code 세션에서 Supabase MCP가 활성화되어 있으면 자동 적용됩니다.');
  } else {
    console.error('  ❌ 예상치 못한 오류:', tableErr.message);
  }

  // ── 3. attractions photo_approved 컬럼 확인 ─────────────────────────────
  console.log('\n🔍 [3/3] attractions.photo_approved 컬럼 확인...');
  const { data: attrData, error: attrErr } = await sb
    .from('attractions')
    .select('photo_approved')
    .limit(1);

  if (!attrErr) {
    console.log('  ✅ 컬럼 이미 존재');
  } else if (attrErr.message?.includes('photo_approved')) {
    console.log('  ⚠️  컬럼 미존재 — destination_metadata_v1.sql 실행 시 함께 추가됩니다.');
  } else {
    console.log('  ⚠️ 확인 불가 (무시):', attrErr.message);
  }

  console.log('\n✅ 셋업 완료. 코드 변경사항은 destination_metadata 없이도 fallback으로 동작합니다.\n');
}

main().catch(e => { console.error(e); process.exit(1); });
