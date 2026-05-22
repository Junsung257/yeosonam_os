/**
 * A1+A2 legacy section backfill — dev 서버 없이 lib 직접 호출.
 *   npx tsx scripts/run-legacy-backfill.ts --dry
 *   npx tsx scripts/run-legacy-backfill.ts
 *   npx tsx scripts/run-legacy-backfill.ts --limit=10
 */
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;

  const { runLegacySectionsBackfillBatch } = await import('../src/lib/legacy-sections-backfill-batch');
  const result = await runLegacySectionsBackfillBatch({ dryRun: dry, limit });
  console.log(JSON.stringify(result, null, 2));
  if (!dry && result.fail > 0) process.exit(1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
