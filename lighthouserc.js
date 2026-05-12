module.exports = {
  ci: {
    collect: {
      // Vercel preview URL 또는 localhost
      url: ['http://localhost:3000'],
      numberOfRuns: 3,
      headless: true,
      settings: {
        chromeFlags: ['--no-sandbox', '--disable-gpu'],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
    assert: {
      preset: 'lighthouse:recommended',
      assertions: {
        // Core Web Vitals 기준
        'categories:performance': ['error', { minScore: 0.80 }],
        'categories:accessibility': ['warn', { minScore: 0.90 }],
        'categories:best-practices': ['warn', { minScore: 0.85 }],
        'categories:seo': ['warn', { minScore: 0.90 }],
        // 구체적 메트릭
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'interaction-to-next-paint': ['error', { maxNumericValue: 200 }],
        'first-contentful-paint': ['error', { maxNumericValue: 1800 }],
      },
    },
  },
};
