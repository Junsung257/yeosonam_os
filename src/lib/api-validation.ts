/**
 * @file api-validation.ts
 * @description API 라우트 입력 검증 표준 유틸리티
 *
 * 사용 예시:
 *   const schema = z.object({ name: z.string(), email: z.string().email() });
 *   const result = await validateRequest(request, schema);
 *   if (!result.success) return result.response;
 *   const { name, email } = result.data;
 */

import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError, ZodSchema } from 'zod';

export type ValidationSuccess<T> = {
  success: true;
  data: T;
};

export type ValidationFailure = {
  success: false;
  response: NextResponse;
};

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

function formatZodError(error: ZodError): { error: string; details: Array<{ path: string; message: string }> } {
  return {
    error: '입력값 검증 실패',
    details: error.errors.map(err => ({
      path: err.path.join('.') || '(root)',
      message: err.message,
    })),
  };
}

/**
 * JSON 요청 바디를 zod 스키마로 검증
 */
export async function validateRequest<T>(
  request: NextRequest,
  schema: ZodSchema<T>,
): Promise<ValidationResult<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      success: false,
      response: NextResponse.json(
        { error: 'JSON 파싱 실패', details: [{ path: '(body)', message: 'Invalid JSON' }] },
        { status: 400 },
      ),
    };
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    return {
      success: false,
      response: NextResponse.json(formatZodError(result.error), { status: 422 }),
    };
  }

  return { success: true, data: result.data };
}

/**
 * URL 쿼리 파라미터를 zod 스키마로 검증
 */
export function validateQuery<T>(
  request: NextRequest,
  schema: ZodSchema<T>,
): ValidationResult<T> {
  const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());

  const result = schema.safeParse(searchParams);
  if (!result.success) {
    return {
      success: false,
      response: NextResponse.json(formatZodError(result.error), { status: 422 }),
    };
  }

  return { success: true, data: result.data };
}

/**
 * 라우트 path 파라미터를 zod 스키마로 검증
 */
export function validateParams<T>(
  params: Record<string, string>,
  schema: ZodSchema<T>,
): ValidationResult<T> {
  const result = schema.safeParse(params);
  if (!result.success) {
    return {
      success: false,
      response: NextResponse.json(formatZodError(result.error), { status: 422 }),
    };
  }

  return { success: true, data: result.data };
}

// ─── 공통 스키마 ──────────────────────────────────────────────────────────────

/** UUID 검증 */
export const UuidSchema = z.string().uuid('유효한 UUID 형식이어야 합니다');

/** 페이지네이션 쿼리 */
export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** ISO 날짜 (YYYY-MM-DD) */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 합니다');

/** 한국 전화번호 */
export const KoreanPhoneSchema = z
  .string()
  .regex(/^010\d{8}$|^010-\d{4}-\d{4}$/, '010-XXXX-XXXX 형식이어야 합니다');

/** 한국 이름 (1-50자) */
export const KoreanNameSchema = z.string().min(1).max(50);

/** 이메일 */
export const EmailSchema = z.string().email('유효한 이메일 형식이어야 합니다');

/** 금액 (1만원 ~ 5천만원) */
export const PriceSchema = z.number().int().min(10_000).max(50_000_000);

/** 비음수 정수 */
export const NonNegativeIntSchema = z.number().int().min(0);

/** 단순 ID 파라미터 (UUID 또는 숫자) */
export const IdParamSchema = z.object({
  id: z.string().refine(
    val => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val) || /^\d+$/.test(val),
    '유효한 ID 형식이어야 합니다 (UUID 또는 숫자)',
  ),
});

// ─── 사용 예시 (문서용) ───────────────────────────────────────────────────────

/**
 * 사용 예시:
 *
 * ```ts
 * import { z } from 'zod';
 * import { validateRequest, KoreanNameSchema, EmailSchema, KoreanPhoneSchema } from '@/lib/api-validation';
 *
 * const CreateCustomerSchema = z.object({
 *   name: KoreanNameSchema,
 *   email: EmailSchema,
 *   phone: KoreanPhoneSchema,
 *   memo: z.string().max(1000).optional(),
 * });
 *
 * export async function POST(request: NextRequest) {
 *   const result = await validateRequest(request, CreateCustomerSchema);
 *   if (!result.success) return result.response;
 *
 *   const { name, email, phone, memo } = result.data;
 *   // ... 비즈니스 로직
 * }
 * ```
 */
