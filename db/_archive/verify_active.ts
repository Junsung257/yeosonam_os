import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

(async () => {
  // 후쿠오카 attractions backfill (force 옵션 사용)
  const { backfillPackageAttractionsL3 } = await import('../src/lib/itinerary-llm-extractor');
  console.log('=== 후쿠오카 attractions hierarchy ===');
  const r = await backfillPackageAttractionsL3('1e82f388-5cca-4d9a-8f53-10f4b0bb17b1', { useLLMFallback: true });
  console.log(JSON.stringify(r, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
