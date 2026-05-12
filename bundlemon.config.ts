import { BundlemonConfig } from 'bundlemon';

const config: BundlemonConfig = {
  baseDir: './build',
  files: [
    {
      path: '*.js',
      maxSize: '500kb',
    },
    {
      path: '*.css',
      maxSize: '100kb',
    },
  ],
  // Compression settings
  compression: 'gzip',
  // CI integration
  ci: {
    // GitHub Actions comment on PR
    githubComment: true,
    // Fail if threshold exceeded
    failOn: 'budget',
  },
  // Local baseline for comparison
  baselineFile: '.bundlemonrc',
  // Detailed reports
  verbose: true,
};

export default config;
