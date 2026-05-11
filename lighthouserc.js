module.exports = {
  ci: {
    collect: {
      url: ['http://localhost:3000/', 'http://localhost:3000/packages', 'http://localhost:3000/blog'],
      numberOfRuns: 3,
      headless: true,
      chromePath: undefined,
      settings: {
        chromeFlags: '--no-sandbox --disable-gpu',
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
    assert: {
      preset: 'lighthouse:all',
      assertions: {
        'categories:performance': ['error', { minScore: 0.80 }],
        'categories:accessibility': ['error', { minScore: 0.90 }],
        'categories:best-practices': ['error', { minScore: 0.85 }],
        'categories:seo': ['error', { minScore: 0.90 }],
        'metric:largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'metric:cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'metric:interaction-to-next-paint': ['error', { maxNumericValue: 200 }],
        'metric:first-contentful-paint': ['error', { maxNumericValue: 1800 }],
      },
    },
  },
};
