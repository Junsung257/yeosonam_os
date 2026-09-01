module.exports = {
  ci: {
    collect: {
      url: ["http://localhost:3000"],
      numberOfRuns: 3,
      headless: true,
      settings: {
        chromeFlags: ["--no-sandbox", "--disable-gpu"],
        // Next.js streams metadata for normal browsers. Mark this synthetic
        // crawler explicitly so SEO audits inspect blocking <head> metadata.
        emulatedUserAgent:
          "Mozilla/5.0 (Linux; Android 11; Mobile) AppleWebKit/537.36 Chrome-Lighthouse Safari/537.36",
      },
    },
    upload: {
      target: "temporary-public-storage",
    },
    assert: {
      assertions: {
        // Explicit contracts avoid new Lighthouse audits silently becoming
        // blocking when the CLI updates. Optimistic aggregation absorbs one
        // noisy run while still requiring one of three runs to meet budget.
        "categories:performance": [
          "error",
          { minScore: 0.8, aggregationMethod: "optimistic" },
        ],
        "categories:accessibility": [
          "error",
          { minScore: 0.95, aggregationMethod: "optimistic" },
        ],
        "categories:best-practices": [
          "warn",
          { minScore: 0.9, aggregationMethod: "optimistic" },
        ],
        "categories:seo": [
          "error",
          { minScore: 0.9, aggregationMethod: "optimistic" },
        ],
        "largest-contentful-paint": [
          "error",
          { maxNumericValue: 2500, aggregationMethod: "optimistic" },
        ],
        "cumulative-layout-shift": [
          "error",
          { maxNumericValue: 0.1, aggregationMethod: "optimistic" },
        ],
        "first-contentful-paint": [
          "error",
          { maxNumericValue: 1800, aggregationMethod: "optimistic" },
        ],
        "label-content-name-mismatch": [
          "error",
          { minScore: 1, aggregationMethod: "optimistic" },
        ],
        "total-byte-weight": [
          "warn",
          { maxNumericValue: 2600000, aggregationMethod: "optimistic" },
        ],
        // Navigation-only lab runs have no real user interaction, so INP is
        // collected from field telemetry instead of an auditRan assertion.
        "interaction-to-next-paint": "off",
      },
    },
  },
};
