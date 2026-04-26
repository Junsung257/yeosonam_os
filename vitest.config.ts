import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * 여소남 OS — Vitest 설정
 *
 * 대상: 순수 lib 단위 테스트 (DB 미접속). 결제·상태머신·렌더 계약 등 load-bearing 로직.
 * Playwright 비주얼 테스트(`tests/visual`)와 회귀 테스트(`tests/regression`)는 별도 러너 사용.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/unit/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'tests/visual', 'tests/regression', '.next', 'out'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts', 'src/lib/**/*.spec.ts'],
    },
  },
});
