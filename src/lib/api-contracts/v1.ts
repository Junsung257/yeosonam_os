import { z } from 'zod';

const IsoDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 합니다')
  .refine(value => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, '유효한 날짜여야 합니다');

const OptionalSearchTextSchema = z.string().trim().min(1).max(100).optional();

export const V1PackageSearchQuerySchema = z.object({
  destination: OptionalSearchTextSchema,
  date_from: IsoDateSchema.optional(),
  date_to: IsoDateSchema.optional(),
  keyword: OptionalSearchTextSchema,
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
}).refine(
  input => !input.date_from || !input.date_to || input.date_from <= input.date_to,
  { message: 'date_from은 date_to보다 늦을 수 없습니다', path: ['date_from'] },
);

export const V1PackageRecommendationBodySchema = z.object({
  destination: OptionalSearchTextSchema,
  date_from: IsoDateSchema.optional(),
  pax: z.coerce.number().int().min(1).max(100).default(2),
});

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
}).passthrough();

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
});

export const V1HealthResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    status: z.enum(['healthy', 'degraded']),
    version: z.string(),
    uptime: z.number().int().nonnegative(),
    db: z.enum(['connected', 'timeout', 'not_configured', 'resource_saver']),
    timestamp: z.string().datetime(),
  }),
});

export const V1ErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
  timestamp: z.string().datetime().optional(),
});
