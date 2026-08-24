import 'server-only';

export type BlogBuildProvenance = {
  readonly gitRef: string | null;
  readonly commitSha: string | null;
  readonly source: 'vercel_build_env' | 'missing';
};

export const BLOG_BUILD_PROVENANCE: BlogBuildProvenance = Object.freeze({
  "gitRef": null,
  "commitSha": null,
  "source": "missing"
});
