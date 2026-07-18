import {
  applyBlogInformationRepresentativeReconciliation,
  loadBlogInformationRepresentativeReconciliationReport,
} from '../src/lib/blog-information-representative-reconciliation-repository';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const confirmation = args.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length) ?? null;
  const report = await loadBlogInformationRepresentativeReconciliationReport();
  const result = await applyBlogInformationRepresentativeReconciliation({
    report,
    apply,
    confirmation,
    environmentValue: process.env.YEOSONAM_ALLOW_INFO_REPRESENTATIVE_APPLY ?? null,
  });
  process.stdout.write(`${JSON.stringify({ mode: apply ? 'apply' : 'dry-run', report, result }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
