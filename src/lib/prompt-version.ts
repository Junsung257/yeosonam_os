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
 *   v1.5 — P0 세일즈마스터 프레임 박제 (2026-04-28):
 *          · Hook 200자 의무 (구체 숫자/장소명/질문) — AI 평서문 평탄함 차단
 *          · FAB 변환 의무 (특징 → 절약액·시간 베네핏)
 *          · 가격 앵커링 단락 의무 (시중가 → 절감액 명시)
 *          · 사회적 증거는 입력 데이터 있을 때만 (환각 금지)
 *          · 3-tier CTA (Above-fold·중간·하단) 분리 의무
 *          · 내부링크 ≥2 + 외부 권위링크 ≥1 (외교부 영사 등)
 *          · E-E-A-T 강화: 추측 형용사 금지 → 검증 가능한 수치/지명만
 */
export const BLOG_PROMPT_VERSION = 'v1.5';
export const BLOG_AI_MODEL = process.env.BLOG_AI_MODEL ?? 'deepseek-v4-flash';
export const BLOG_AI_TEMPERATURE = 0.7; // 단일 생성
export const BLOG_AI_TEMPERATURE_BULK = 0.8; // 일괄 생성 (다양성↑)
