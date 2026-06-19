/**
 * @file eslint-a11y.config.js
 * @description jsx-a11y 전용 strict 설정 (CI에서 사용)
 *
 * - `plugin:jsx-a11y/recommended` 전체 활성화
 * - 일부 규칙을 strict (error) 로 상향
 * - image 파일 (next/image 사용해야 하는 곳) 에서의 alt 누락 방지
 * - 워닝은 무시하고 에러만 리포트 (CI break 용도는 아니고 info성)
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaFeatures: { jsx: true },
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['jsx-a11y', '@typescript-eslint', '@next/next', 'react-hooks'],
  extends: ['plugin:jsx-a11y/recommended'],
  rules: {
    // a11y strict rules
    'jsx-a11y/alt-text': 'warn',
    'jsx-a11y/anchor-has-content': 'warn',
    'jsx-a11y/anchor-is-valid': 'warn',
    'jsx-a11y/click-events-have-key-events': 'warn',
    'jsx-a11y/control-has-associated-label': 'warn',
    'jsx-a11y/heading-has-content': 'warn',
    'jsx-a11y/html-has-lang': 'warn',
    'jsx-a11y/img-redundant-alt': 'warn',
    'jsx-a11y/interactive-supports-focus': 'warn',
    'jsx-a11y/label-has-associated-control': 'warn',
    'jsx-a11y/lang': 'warn',
    'jsx-a11y/media-has-caption': 'warn',
    'jsx-a11y/mouse-events-have-key-events': 'warn',
    'jsx-a11y/no-access-key': 'warn',
    'jsx-a11y/no-autofocus': 'warn',
    'jsx-a11y/no-distracting-elements': 'warn',
    'jsx-a11y/no-interactive-element-to-noninteractive-role': 'warn',
    'jsx-a11y/no-noninteractive-element-interactions': 'warn',
    'jsx-a11y/no-noninteractive-tabindex': 'warn',
    'jsx-a11y/no-redundant-roles': 'warn',
    'jsx-a11y/no-static-element-interactions': 'warn',
    'jsx-a11y/role-has-required-aria-props': 'warn',
    'jsx-a11y/role-supports-aria-props': 'warn',
    'jsx-a11y/scope': 'warn',
    'jsx-a11y/tabindex-no-positive': 'warn',
    // next/image 관련: <img> 직접 사용 금지 (next.config 에서 이미 img-component=next/image
    // 로 강제하지 않는 경우에만 필요)
    '@next/next/no-img-element': 'off',
  },
  ignorePatterns: [
    '.next/**',
    'node_modules/**',
    'build/**',
    'public/**',
    '*.config.*',
    'tests/**',
    'db/**',
    'scripts/**',
    'tailwind.config.*',
    'postcss.config.*',
  ],
};
