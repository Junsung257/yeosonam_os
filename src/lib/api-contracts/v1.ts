import {
  extendZodWithOpenApi,
  OpenApiGeneratorV3,
  OpenAPIRegistry,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

const IsoDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 합니다')
  .refine(value => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, '유효한 날짜여야 합니다')
  .openapi({ example: '2026-09-01' });

const OptionalSearchTextSchema = z.string().trim().min(1).max(100).optional();

export const V1PackageSearchQuerySchema = z.object({
  destination: OptionalSearchTextSchema.openapi({ example: '다낭' }),
  date_from: IsoDateSchema.optional(),
  date_to: IsoDateSchema.optional(),
  keyword: OptionalSearchTextSchema.openapi({ example: '부산 출발' }),
  limit: z.coerce.number().int().min(1).max(100).default(20).openapi({ example: 20 }),
  offset: z.coerce.number().int().min(0).max(10_000).default(0).openapi({ example: 0 }),
}).refine(
  input => !input.date_from || !input.date_to || input.date_from <= input.date_to,
  { message: 'date_from은 date_to보다 늦을 수 없습니다', path: ['date_from'] },
).openapi('V1PackageSearchQuery');

export const V1PackageRecommendationBodySchema = z.object({
  destination: OptionalSearchTextSchema,
  date_from: IsoDateSchema.optional(),
  pax: z.coerce.number().int().min(1).max(100).default(2).openapi({ example: 2 }),
}).openapi('V1PackageRecommendationBody');

export const V1PublicPackageSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullable().optional(),
  display_title: z.string().nullable().optional(),
  destination: z.string().nullable().optional(),
  duration: z.union([z.string(), z.number()]).nullable().optional(),
  days: z.union([z.string(), z.number()]).nullable().optional(),
  nights: z.union([z.string(), z.number()]).nullable().optional(),
  price: z.number().nonnegative().nullable().optional(),
  price_display: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  badges: z.array(z.unknown()).optional(),
  publication_state: z.string().nullable().optional(),
  package_revision: z.union([z.string(), z.number()]).nullable().optional(),
}).passthrough().openapi('V1PublicPackage');

export const V1PackageListResponseSchema = z.object({
  ok: z.literal(true),
  data: z.array(V1PublicPackageSchema),
  pagination: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
  }),
  degraded: z.boolean().optional(),
  reason: z.string().optional(),
}).openapi('V1PackageListResponse');

export const V1HealthResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    status: z.enum(['healthy', 'degraded']),
    version: z.string(),
    uptime: z.number().int().nonnegative(),
    db: z.enum(['connected', 'timeout', 'not_configured', 'resource_saver']),
    timestamp: z.string().datetime(),
  }),
}).openapi('V1HealthResponse');

export const V1ErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
  timestamp: z.string().datetime().optional(),
}).openapi('V1ErrorResponse');

export function createV1OpenApiDocument() {
  const registry = new OpenAPIRegistry();
  registry.register('V1HealthResponse', V1HealthResponseSchema);
  registry.register('V1PackageListResponse', V1PackageListResponseSchema);
  registry.register('V1ErrorResponse', V1ErrorResponseSchema);
  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'Yeosonam API key',
    description: '여소남에서 발급한 ysn_ API 키',
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/health',
    summary: 'API 상태 확인',
    tags: ['System'],
    responses: {
      200: {
        description: '현재 API 및 데이터베이스 상태',
        content: { 'application/json': { schema: V1HealthResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/packages',
    summary: '공개 여행상품 검색',
    tags: ['Packages'],
    security: [{ bearerAuth: [] }],
    request: { query: V1PackageSearchQuerySchema },
    responses: {
      200: {
        description: '현재 공개 포인터가 가리키는 상품 목록',
        content: { 'application/json': { schema: V1PackageListResponseSchema } },
      },
      400: {
        description: '잘못된 검색 조건',
        content: { 'application/json': { schema: V1ErrorResponseSchema } },
      },
      401: {
        description: '유효하지 않은 API 키',
        content: { 'application/json': { schema: V1ErrorResponseSchema } },
      },
      403: {
        description: '필요한 API 스코프 없음',
        content: { 'application/json': { schema: V1ErrorResponseSchema } },
      },
      500: {
        description: '서버 오류',
        content: { 'application/json': { schema: V1ErrorResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/packages',
    summary: '조건 기반 공개 여행상품 추천',
    tags: ['Packages'],
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: V1PackageRecommendationBodySchema } },
      },
    },
    responses: {
      200: {
        description: '현재 공개 포인터가 가리키는 추천 상품',
        content: { 'application/json': { schema: V1PackageListResponseSchema } },
      },
      400: {
        description: '잘못된 추천 조건',
        content: { 'application/json': { schema: V1ErrorResponseSchema } },
      },
      401: {
        description: '유효하지 않은 API 키',
        content: { 'application/json': { schema: V1ErrorResponseSchema } },
      },
      403: {
        description: '필요한 API 스코프 없음',
        content: { 'application/json': { schema: V1ErrorResponseSchema } },
      },
      500: {
        description: '서버 오류',
        content: { 'application/json': { schema: V1ErrorResponseSchema } },
      },
    },
  });

  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Yeosonam External API',
      version: '1.0.0',
      description: '여소남 외부 연동 API의 실행 가능한 계약입니다.',
    },
    servers: [{ url: 'https://www.yeosonam.com' }],
  });
}
