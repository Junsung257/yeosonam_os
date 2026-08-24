import fs from 'node:fs';
import path from 'node:path';

const output = path.resolve('src/generated/blog-build-provenance.server.ts');
const directory = path.dirname(output);
const normalize = (value) => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

const gitRef = normalize(process.env.VERCEL_GIT_COMMIT_REF);
const commitSha = normalize(process.env.VERCEL_GIT_COMMIT_SHA);
const source = gitRef || commitSha ? 'vercel_build_env' : 'missing';
const content = `import 'server-only';

export type BlogBuildProvenance = {
  readonly gitRef: string | null;
  readonly commitSha: string | null;
  readonly source: 'vercel_build_env' | 'missing';
};

export const BLOG_BUILD_PROVENANCE: BlogBuildProvenance = Object.freeze(${JSON.stringify({
  gitRef,
  commitSha,
  source,
}, null, 2)});
`;

fs.mkdirSync(directory, { recursive: true });
if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== content) {
  fs.writeFileSync(output, content, 'utf8');
}
console.log(`[blog-provenance] source=${source} ref=${gitRef || 'missing'} sha=${commitSha ? 'present' : 'missing'}`);
