/**
 * 블로그 생성 프롬프트 버전 관리
 *
 * 프롬프트를 크게 수정할 때마다 버전을 올린다.
 * content_creatives.prompt_version에 기록되어 성과 비교 학습에 사용됨.
 *
 * 변경 이력:
 *   v1.0 — 초기 템플릿 기반 (2026-04-09)
 *   v1.1 — Gemini 리라이트 추가 (2026-04-09)
 *   v1.2 — 박수 정확성 + 이미지 URL 보호 + 볼드 금지 (2026-04-09)
 *   v1.3 — SEO 제목 최적화 (출발지+가격+브랜드) (2026-04-09)
 *   v1.4 — 가격 팩트 보호 + $30 제거 (2026-04-09)
 */
export const BLOG_PROMPT_VERSION = 'v1.4';
export const BLOG_AI_MODEL = 'gemini-2.5-flash';
export const BLOG_AI_TEMPERATURE = 0.7; // 단일 생성
export const BLOG_AI_TEMPERATURE_BULK = 0.8; // 일괄 생성 (다양성↑)
