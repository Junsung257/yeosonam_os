/**
 * @file env.ts
 * @description 타입 안전 환경변수 게이트 (@t3-oss/env-nextjs).
 *
 * 목적:
 *  - 빌드 시점에 필수 환경변수 누락을 즉시 fail (배포 후 런타임 크래시 방지)
 *  - Server vs Client (NEXT_PUBLIC_*) 분리 강제 — 클라 번들에 비밀 누출 차단
 *  - 자동완성 + 타입 안전 — `env.ANTHROPIC_API_KEY` 가 string|undefined 정확 추론
 *
 * 점진 마이그레이션 전략:
 *  - 신규 코드는 `import { env } from '@/env'` 사용
 *  - 기존 코드는 `getSecret()` (src/lib/secret-registry.ts) 유지 가능
 *  - 100+ 키 전체를 옮기지 않음 — 핵심 인프라 키만 정의
 *
 * 주의:
 *  - skipValidation 옵션은 dev/test 에서만 — production build 는 강제
 *  - .optional() 적극 사용 — 미설정 키가 빌드 fail 시키면 deploy 마비
 */

import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  /**
   * Server-only 환경변수 — client 번들에 절대 포함 X.
   * 누락 시 server 동작 불가 → 그래도 빌드는 통과 (.optional()) — 런타임 fallback 책임은 호출 측.
   */
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // ── Supabase (server) ──
    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    SUPABASE_JWT_SECRET: z.string().min(1).optional(),

    // ── LLM Providers ──
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    DEEPSEEK_API_KEY: z.string().min(1).optional(),
    GEMINI_API_KEY: z.string().min(1).optional(),
    GOOGLE_AI_API_KEY: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),

    // ── Cron / Internal ──
    CRON_SECRET: z.string().min(1).optional(),
    ADMIN_API_TOKEN: z.string().min(1).optional(),
    REVALIDATE_SECRET: z.string().min(1).optional(),

    // ── Rate Limit (Upstash, P0-1) ──
    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),

    // ── Crypto ──
    ENCRYPTION_SECRET_KEY: z.string().min(32).optional(),

    // ── Telemetry ──
    SENTRY_DSN: z.string().url().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    OTEL_SERVICE_NAME: z.string().optional(),
  },

  /**
   * Client 노출 변수 — 반드시 NEXT_PUBLIC_ prefix.
   * t3-env 가 build 시 prefix 누락을 자동 차단.
   */
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
    NEXT_PUBLIC_BASE_URL: z.string().url().optional(),
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
    NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
    NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  },

  /**
   * Next.js 13+ Edge runtime 은 process.env 동적 인덱싱이 inline 안 되므로
   * 명시적으로 매핑 필요. (Next 14.2 기준)
   */
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_AI_API_KEY: process.env.GOOGLE_AI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
    ADMIN_API_TOKEN: process.env.ADMIN_API_TOKEN,
    REVALIDATE_SECRET: process.env.REVALIDATE_SECRET,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    ENCRYPTION_SECRET_KEY: process.env.ENCRYPTION_SECRET_KEY,
    SENTRY_DSN: process.env.SENTRY_DSN,
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  },

  /**
   * 빈 문자열을 undefined 처럼 처리.
   * Vercel UI 에서 키 추가 후 값 미입력 시 흔한 실수.
   */
  emptyStringAsUndefined: true,

  /**
   * dev / test 에서는 빌드 게이트 비활성화 (개발 편의).
   * production build 만 강제.
   *
   * SKIP_ENV_VALIDATION=true 는 CI dummy 빌드용 escape — 실제 deploy 환경에선 절대 설정 X.
   */
  skipValidation: process.env.NODE_ENV !== 'production' || process.env.SKIP_ENV_VALIDATION === 'true',
});

// ────────────────────────────────────────────────────────────────────────────
// requireEnv — 호출 시점 fail-fast 헬퍼 (코드리뷰 fix)
//
// 모든 env 가 .optional() 라 t3-env 빌드 게이트가 사실상 검증을 안 함.
// 진짜 필수 키는 호출 측에서 requireEnv() 로 강제 — undefined 즉시 throw.
//
// 사용:
//   const url = requireEnv('SUPABASE_URL');         // 없으면 throw, 있으면 string
//   const key = requireEnv('ANTHROPIC_API_KEY', '주문 처리 시 필수');
// ────────────────────────────────────────────────────────────────────────────

type EnvKeys = keyof typeof env;

/**
 * env 키가 정의되어 있지 않으면 즉시 throw.
 * @param key env 키
 * @param hint 에러 메시지에 추가할 컨텍스트 (어디에 필요한지)
 * @returns 검증된 string (never undefined)
 */
export function requireEnv<K extends EnvKeys>(key: K, hint?: string): string {
  const value = env[key];
  if (value === undefined || value === null || value === '') {
    const ctx = hint ? ` (${hint})` : '';
    throw new Error(`[env] 필수 환경변수 ${String(key)} 누락${ctx}. Vercel 환경변수 설정 확인 필요.`);
  }
  return String(value);
}

/**
 * 여러 키를 한 번에 검증. 누락 시 모든 누락 키를 한 메시지로 throw.
 * 시작 시점(API 라우트 진입 / 모듈 init) 에서 batch 검증용.
 */
export function requireEnvAll<K extends EnvKeys>(keys: readonly K[], hint?: string): Record<K, string> {
  const missing: string[] = [];
  const result = {} as Record<K, string>;
  for (const key of keys) {
    const value = env[key];
    if (value === undefined || value === null || value === '') {
      missing.push(String(key));
    } else {
      result[key] = String(value);
    }
  }
  if (missing.length > 0) {
    const ctx = hint ? ` (${hint})` : '';
    throw new Error(`[env] 필수 환경변수 누락${ctx}: ${missing.join(', ')}`);
  }
  return result;
}
