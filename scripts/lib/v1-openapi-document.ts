import {
  extendZodWithOpenApi,
  OpenApiGeneratorV3,
  OpenAPIRegistry,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  V1ErrorResponseSchema,
  V1HealthResponseSchema,
  V1PackageListResponseSchema,
  V1PackageRecommendationBodySchema,
  V1PackageSearchQuerySchema,
  V1PublicPackageSchema,
} from '../../src/lib/api-contracts/v1';

extendZodWithOpenApi(z);

export function createV1OpenApiDocument() {
  const healthResponseSchema = V1HealthResponseSchema.openapi('V1HealthResponse');
  const publicPackageSchema = V1PublicPackageSchema.openapi('V1PublicPackage');
  const packageListResponseSchema = V1PackageListResponseSchema.extend({
    data: z.array(publicPackageSchema),
  }).openapi('V1PackageListResponse');
  const errorResponseSchema = V1ErrorResponseSchema.openapi('V1ErrorResponse');
  const packageSearchQuerySchema = V1PackageSearchQuerySchema.openapi('V1PackageSearchQuery');
  const packageRecommendationBodySchema = V1PackageRecommendationBodySchema.openapi('V1PackageRecommendationBody');

  const registry = new OpenAPIRegistry();
  registry.register('V1HealthResponse', healthResponseSchema);
  registry.register('V1PublicPackage', publicPackageSchema);
  registry.register('V1PackageListResponse', packageListResponseSchema);
  registry.register('V1ErrorResponse', errorResponseSchema);
  registry.register('V1PackageRecommendationBody', packageRecommendationBodySchema);
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
        content: { 'application/json': { schema: healthResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/packages',
    summary: '공개 여행상품 검색',
    tags: ['Packages'],
    security: [{ bearerAuth: [] }],
    request: { query: packageSearchQuerySchema },
    responses: {
      200: {
        description: '현재 공개 포인터가 가리키는 상품 목록',
        content: { 'application/json': { schema: packageListResponseSchema } },
      },
      400: {
        description: '잘못된 검색 조건',
        content: { 'application/json': { schema: errorResponseSchema } },
      },
      401: {
        description: '유효하지 않은 API 키',
        content: { 'application/json': { schema: errorResponseSchema } },
      },
      403: {
        description: '필요한 API 스코프 없음',
        content: { 'application/json': { schema: errorResponseSchema } },
      },
      500: {
        description: '서버 오류',
        content: { 'application/json': { schema: errorResponseSchema } },
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
        content: { 'application/json': { schema: packageRecommendationBodySchema } },
      },
    },
    responses: {
      200: {
        description: '현재 공개 포인터가 가리키는 추천 상품',
        content: { 'application/json': { schema: packageListResponseSchema } },
      },
      400: {
        description: '잘못된 추천 조건',
        content: { 'application/json': { schema: errorResponseSchema } },
      },
      401: {
        description: '유효하지 않은 API 키',
        content: { 'application/json': { schema: errorResponseSchema } },
      },
      403: {
        description: '필요한 API 스코프 없음',
        content: { 'application/json': { schema: errorResponseSchema } },
      },
      500: {
        description: '서버 오류',
        content: { 'application/json': { schema: errorResponseSchema } },
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
