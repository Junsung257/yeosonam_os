import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const limitArg = Number(args.find((arg) => arg.startsWith('--limit='))?.split('=')[1]);
const baseUrl = args.find((arg) => arg.startsWith('--base-url='))?.split('=')[1];

const limit = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : undefined;

async function main() {
  const { processDueBlogIndexingJobs } = await import('../src/lib/blog-indexing-worker');
  const summary = await processDueBlogIndexingJobs({
    limit,
    baseUrl,
    workerName: 'blog-indexing-worker-manual',
  });

  if (jsonMode) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(
      [
        `processed=${summary.processed}`,
        `succeeded=${summary.succeeded ?? 0}`,
        `retry=${summary.retry ?? 0}`,
        `failed=${summary.failed ?? 0}`,
        `stale_reset=${summary.stale_reset}`,
      ].join(' '),
    );
    for (const result of summary.results) {
      console.log(`${result.status} ${result.slug}${result.error ? ` - ${result.error}` : ''}`);
    }
    for (const error of summary.errors) {
      console.error(error);
    }
  }

  if ((summary.failed ?? 0) > 0 || summary.errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
