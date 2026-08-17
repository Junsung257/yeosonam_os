import { verifyBlogOrchestratorV4ReleaseBundle } from './lib/blog-orchestrator-v4-release-bundle';

try {
  const bundle = verifyBlogOrchestratorV4ReleaseBundle();
  process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`blog orchestrator V4 release bundle invalid: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
