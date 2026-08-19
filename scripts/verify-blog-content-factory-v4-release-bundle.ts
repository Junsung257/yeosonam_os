import { verifyBlogContentFactoryV4ReleaseBundle } from './lib/blog-content-factory-v4-release-bundle';

try {
  process.stdout.write(`${JSON.stringify(verifyBlogContentFactoryV4ReleaseBundle(), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`blog content factory V4 release bundle invalid: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
