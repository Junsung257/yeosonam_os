import { verifyBlogEditorialHarnessV5ReleaseBundle } from './lib/blog-editorial-harness-v5-release-bundle';

try {
  process.stdout.write(`${JSON.stringify(verifyBlogEditorialHarnessV5ReleaseBundle(), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`blog editorial harness V5 release bundle invalid: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
