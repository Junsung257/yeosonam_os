/**
 * desc_batch_*.json 파일들을 읽어서 DB에 일괄 업데이트하는 스크립트
 * 사용법: node db/upsert_descriptions.js
 */
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const dbDir = path.join(__dirname);
  const batchFiles = fs.readdirSync(dbDir)
    .filter(f => f.startsWith('desc_batch_') && f.endsWith('.json'))
    .sort();

  console.log(`📁 배치 파일 ${batchFiles.length}개 발견: ${batchFiles.join(', ')}`);

  let totalUpdated = 0;
  let totalErrors = 0;

  for (const file of batchFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(dbDir, file), 'utf-8'));
    console.log(`\n📝 ${file}: ${data.length}개 처리 중...`);

    let fileUpdated = 0;
    for (const item of data) {
      if (!item.id || !item.short_desc) {
        console.log(`  ⚠️ 스킵 (id 또는 short_desc 없음): ${JSON.stringify(item).slice(0, 80)}`);
        continue;
      }

      const updateData = { short_desc: item.short_desc };
      if (item.long_desc) updateData.long_desc = item.long_desc;

      const { error } = await supabase
        .from('attractions')
        .update(updateData)
        .eq('id', item.id);

      if (error) {
        console.log(`  ❌ ${item.id}: ${error.message}`);
        totalErrors++;
      } else {
        fileUpdated++;
      }
    }

    console.log(`  ✅ ${fileUpdated}/${data.length}개 업데이트`);
    totalUpdated += fileUpdated;
  }

  console.log(`\n🎉 완료! 총 ${totalUpdated}개 업데이트, ${totalErrors}개 에러`);
}

main().catch(console.error);
