import { verifyBlogMigrationReleaseBundleV3 } from './lib/blog-migration-release-bundle-v3';

try {
  const bundle = verifyBlogMigrationReleaseBundleV3();
  process.stdout.write(`${JSON.stringify({ ok: true, ...bundle }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
