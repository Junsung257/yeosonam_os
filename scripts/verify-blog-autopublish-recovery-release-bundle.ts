import { verifyBlogAutopublishRecoveryReleaseBundle } from './lib/blog-autopublish-recovery-release-bundle';

try {
  process.stdout.write(`${JSON.stringify(verifyBlogAutopublishRecoveryReleaseBundle(), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`blog autopublish recovery release verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
