import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ProductPriceRowSchema } from '@/lib/upload-validator';
import type { StandardProductRegistrationObject } from './types';

const Hash64Schema = z.string().regex(/^[a-f0-9]{64}$/);
const PriceDateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  price: z.number().int().min(10_000).max(50_000_000),
  child_price: z.number().int().min(0).max(50_000_000).optional(),
  confirmed: z.boolean().optional(),
}).passthrough();

const EvidenceSpanSchema = z.object({
  field: z.string().min(1),
  rawTextHash: Hash64Schema,
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  quote: z.string(),
  confidence: z.number().min(0).max(1),
}).passthrough().refine(span => span.end >= span.start, {
  message: 'span end must be greater than or equal to start',
});

export const StandardProductRegistrationObjectSchema = z.object({
  extractedData: z.object({
    title: z.string().min(1).optional(),
    destination: z.string().nullable().optional(),
    duration: z.number().int().min(1).max(60).optional(),
    rawText: z.string().optional(),
  }).passthrough(),
  pricing: z.object({
    productPrices: z.array(ProductPriceRowSchema),
    priceDates: z.array(PriceDateSchema),
    minPrice: z.number().int().min(10_000).max(50_000_000).nullable(),
    failures: z.array(z.string()).default([]),
  }).passthrough(),
  itinerary: z.object({
    itineraryDataToSave: z.unknown().nullable(),
    scheduleItemCount: z.number().int().min(0),
  }).passthrough(),
  deliverability: z.object({
    ok: z.boolean(),
    blockers: z.array(z.string()),
  }),
  evidence: z.object({
    rawTextLength: z.number().int().min(0),
    rawTextHash: Hash64Schema,
    priceSource: z.string().min(1).optional(),
    spans: z.array(EvidenceSpanSchema).default([]),
  }).passthrough(),
}).passthrough().superRefine((registration, ctx) => {
  const days = (registration.itinerary.itineraryDataToSave as { days?: unknown[] } | null | undefined)?.days;
  const hasItineraryDays = Array.isArray(days) && days.length > 0;

  if (registration.deliverability.ok) {
    if (registration.pricing.productPrices.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pricing', 'productPrices'],
        message: 'deliverable registration requires at least one product_prices row',
      });
    }
    if (registration.pricing.priceDates.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pricing', 'priceDates'],
        message: 'deliverable registration requires at least one price_dates row',
      });
    }
    if (!hasItineraryDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['itinerary', 'itineraryDataToSave'],
        message: 'deliverable registration requires itinerary_data.days',
      });
    }
  }

  for (const span of registration.evidence.spans) {
    if (span.rawTextHash !== registration.evidence.rawTextHash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidence', 'spans'],
        message: `evidence span hash mismatch for ${span.field}`,
      });
      break;
    }
  }
});

export const StandardProductRegistrationJsonSchema = zodToJsonSchema(
  StandardProductRegistrationObjectSchema,
  {
    name: 'StandardProductRegistrationObject',
    target: 'jsonSchema7',
    $refStrategy: 'none',
  },
);

export type StandardRegistrationSchemaValidation = {
  ok: boolean;
  issues: string[];
};

export function validateStandardProductRegistrationObject(
  registration: StandardProductRegistrationObject,
): StandardRegistrationSchemaValidation {
  const result = StandardProductRegistrationObjectSchema.safeParse(registration);
  if (result.success) return { ok: true, issues: [] };
  return {
    ok: false,
    issues: result.error.issues.map(issue => (
      `${issue.path.join('.') || 'registration'}: ${issue.message}`
    )),
  };
}

export function formatStandardRegistrationSchemaIssues(
  validation: StandardRegistrationSchemaValidation,
): string {
  return validation.issues.slice(0, 6).join(' | ') || 'standard registration schema failed';
}
