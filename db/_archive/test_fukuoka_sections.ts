import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

(async () => {
  const { backfillSectionsByPackageId } = await import('../src/lib/parser/llm/section-extractors');
  console.log('Testing backfillSectionsByPackageId on Fukuoka with force=true...');
  const r = await backfillSectionsByPackageId('1e82f388-5cca-4d9a-8f53-10f4b0bb17b1', { force: true });
  console.log(JSON.stringify(r, null, 2));
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
