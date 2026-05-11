import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    // 글로벌 테스트 설정
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/unit/setup.ts'],

    // 커버리지 설정
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'tests/',
        'dist/',
        '.next/',
        '**/*.spec.ts',
        '**/*.test.ts',
      ],
      // 커버리지 임계값 (하단에 실패하면 테스트 실패)
      lines: 80,
      functions: 80,
      branches: 75,
      statements: 80,
    },

    // 성능 최적화
    isolate: true,
    threads: true,
    maxThreads: 4,
    minThreads: 1,

    // 테스트 타임아웃
    testTimeout: 10000,

    // 입력값 변화 감시 모드
    watch: false,

    // 상세한 로그
    reporter: ['verbose'],

    // 병렬 실행
    maxConcurrency: 5,
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
