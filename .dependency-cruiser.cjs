/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: '순환 의존은 빌드 race / HMR 깨짐 / 테스트 mock 어려움 → 신규는 차단.',
      from: {
        // Known baseline: src/lib/supabase.ts ↔ src/lib/db/* / affiliate/* facade 패턴.
        //   supabase.ts 가 13개 db helper 를 re-export 하면서 발생.
        //   별도 PR 로 facade 분리 예정 (P3) — 그 전까지 화이트리스트.
        pathNot: [
          '^src/lib/supabase\\.ts$',
          '^src/lib/db/.*\\.ts$',
          '^src/lib/affiliate/.*\\.ts$',
        ],
      },
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'info',
      comment: 'orphan 모듈 (어디에서도 import 안 됨) — 정리 후보. info 레벨로 보고만.',
      from: {
        orphan: true,
        pathNot: [
          'src/app/.+/(page|layout|loading|error|not-found|route|opengraph-image)\\.(ts|tsx)$',
          'src/middleware\\.ts$',
          'src/instrumentation\\.ts$',
          'src/env\\.ts$',
          'src/app/sw\\.ts$',
          'sentry\\.(client|server|edge)\\.config\\.ts$',
          '\\.test\\.ts$',
          '\\.spec\\.ts$',
        ],
      },
      to: {},
    },
    {
      name: 'no-deprecated-deps',
      severity: 'warn',
      from: {},
      to: {
        dependencyTypes: ['deprecated'],
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
