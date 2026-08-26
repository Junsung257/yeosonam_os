import { describe, expect, it } from 'vitest';
import {
  createV1OpenApiDocument,
  V1HealthResponseSchema,
  V1PackageRecommendationBodySchema,
  V1PackageSearchQuerySchema,
} from './v1';

describe('external API v1 contract', () => {
  it('publishes health and package operations with package authentication', () => {
    const document = createV1OpenApiDocument();

    expect(document.openapi).toBe('3.0.3');
    expect(document.paths['/api/v1/health']?.get).toBeDefined();
    expect(document.paths['/api/v1/packages']?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(document.paths['/api/v1/packages']?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(document.components?.securitySchemes?.bearerAuth).toBeDefined();
  });

  it('normalizes safe package query defaults and rejects invalid ranges', () => {
    expect(V1PackageSearchQuerySchema.parse({})).toMatchObject({ limit: 20, offset: 0 });
    expect(V1PackageSearchQuerySchema.parse({ limit: '10', offset: '2' })).toMatchObject({ limit: 10, offset: 2 });
    expect(V1PackageSearchQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(V1PackageSearchQuerySchema.safeParse({ date_from: '2026-02-31' }).success).toBe(false);
    expect(V1PackageSearchQuerySchema.safeParse({ date_from: '2026-10-01', date_to: '2026-09-01' }).success).toBe(false);
  });

  it('rejects malformed recommendation inputs', () => {
    expect(V1PackageRecommendationBodySchema.parse({ pax: '4' }).pax).toBe(4);
    expect(V1PackageRecommendationBodySchema.safeParse({ pax: 0 }).success).toBe(false);
    expect(V1PackageRecommendationBodySchema.safeParse({ date_from: 'tomorrow' }).success).toBe(false);
  });

  it('accepts the runtime health response shape', () => {
    expect(V1HealthResponseSchema.safeParse({
      ok: true,
      data: {
        status: 'degraded',
        version: '1.0.0',
        uptime: 1,
        db: 'resource_saver',
        timestamp: new Date().toISOString(),
      },
    }).success).toBe(true);
  });
});
