/**
 * Standardized API Response Format
 * 모든 엔드포인트에서 일관된 응답 포맷 사용
 */

import { NextResponse } from 'next/server';

// ─── Response Types ───────────────────────────────────────────────────────
export interface ApiSuccessResponse<T = unknown> {
  ok: true;
  data: T;
  timestamp?: string;
}

export interface ApiErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp?: string;
}

export interface ApiListResponse<T> {
  ok: true;
  data: T[];
  pagination?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  timestamp?: string;
}

// ─── Response Builders ───────────────────────────────────────────────────
export function cacheHeader(seconds: number): Record<string, string> {
  return {
    'Cache-Control': `public, s-maxage=${seconds}, stale-while-revalidate=${Math.floor(seconds / 2)}`,
  };
}

export function apiResponse<T>(
  body: T,
  init?: ResponseInit & { cacheSeconds?: number }
) {
  const { cacheSeconds, headers, ...responseInit } = init ?? {};
  const responseHeaders = new Headers(headers);

  if (cacheSeconds !== undefined && !responseHeaders.has('Cache-Control')) {
    responseHeaders.set('Cache-Control', cacheHeader(cacheSeconds)['Cache-Control']);
  }

  return NextResponse.json<T>(body, {
    ...responseInit,
    headers: responseHeaders,
  });
}

export function successResponse<T>(data: T, status: number = 200, cacheSeconds?: number) {
  return NextResponse.json<ApiSuccessResponse<T>>(
    {
      ok: true,
      data,
      timestamp: new Date().toISOString(),
    },
    {
      status,
      headers: cacheSeconds ? cacheHeader(cacheSeconds) : undefined,
    }
  );
}

export function listResponse<T>(
  data: T[],
  options?: {
    total?: number;
    page?: number;
    limit?: number;
    cacheSeconds?: number;
  },
  status: number = 200
) {
  const response: ApiListResponse<T> = {
    ok: true,
    data,
    timestamp: new Date().toISOString(),
  };

  if (options?.total !== undefined) {
    response.pagination = {
      total: options.total,
      page: options.page ?? 1,
      limit: options.limit ?? 20,
      totalPages: Math.ceil(options.total / (options.limit ?? 20)),
    };
  }

  return NextResponse.json<ApiListResponse<T>>(response, {
    status,
    headers: options?.cacheSeconds ? cacheHeader(options.cacheSeconds) : undefined,
  });
}

export function errorResponse(
  code: string,
  message: string,
  status: number = 400,
  details?: unknown
) {
  return NextResponse.json<ApiErrorResponse>(
    {
      ok: false,
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
      timestamp: new Date().toISOString(),
    },
    { status }
  );
}

// ─── Common Error Codes ───────────────────────────────────────────────────
export const ErrorCodes = {
  INVALID_INPUT: 'INVALID_INPUT',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNAVAILABLE: 'UNAVAILABLE',
} as const;

// ─── Shorthand Helpers ───────────────────────────────────────────────────
export const ApiErrors = {
  badRequest: (message: string, details?: unknown) =>
    errorResponse(ErrorCodes.INVALID_INPUT, message, 400, details),

  notFound: (message: string = '찾을 수 없습니다') =>
    errorResponse(ErrorCodes.NOT_FOUND, message, 404),

  unauthorized: (message: string = '인증이 필요합니다') =>
    errorResponse(ErrorCodes.UNAUTHORIZED, message, 401),

  forbidden: (message: string = '권한이 없습니다') =>
    errorResponse(ErrorCodes.FORBIDDEN, message, 403),

  conflict: (message: string, details?: unknown) =>
    errorResponse(ErrorCodes.CONFLICT, message, 409, details),

  rateLimited: (message: string = '요청이 너무 많습니다') =>
    errorResponse(ErrorCodes.RATE_LIMITED, message, 429),

  internalError: (message: string = '서버 오류가 발생했습니다', details?: unknown) =>
    errorResponse(ErrorCodes.INTERNAL_ERROR, message, 500, details),

  unavailable: (message: string = '서비스를 사용할 수 없습니다') =>
    errorResponse(ErrorCodes.UNAVAILABLE, message, 503),
} as const;
