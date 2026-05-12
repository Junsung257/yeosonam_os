/**
 * Request validation schemas (Zod)
 * Sprint 1 Action #14 확장 — API 입력값 검증 통합
 */

import { z } from 'zod';

// ─── Customer schemas ──────────────────────────────────────────────────────
export const CreateCustomerSchema = z.object({
  name: z.string().min(1, 'Customer name required').max(100),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  tags: z.array(z.string()).optional(),
  memo: z.string().optional().nullable(),
  grade: z.enum(['bronze', 'silver', 'gold', 'platinum', 'diamond']).optional(),
  mileage: z.number().int().nonnegative().optional(),
});

export const UpdateCustomerSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  tags: z.array(z.string()).optional(),
  memo: z.string().optional().nullable(),
  status: z.enum(['active', 'inactive', 'blocked']).optional(),
  mileage: z.number().int().nonnegative().optional(),
});

// ─── Booking schemas ──────────────────────────────────────────────────────
export const CancelBookingSchema = z.object({
  refund_amount: z.number().nonnegative().optional(),
  penalty_fee: z.number().nonnegative().optional(),
  reason: z.string().optional(),
  reason_category: z.enum([
    'customer_request', 'customer_schedule', 'customer_health',
    'customer_payment_fail', 'product_unavailable', 'price_mismatch',
    'competitor_switch', 'land_operator_issue', 'force_majeure',
    'duplicate_booking', 'system_error', 'admin_force', 'other',
  ]).optional(),
  reason_subnote: z.string().max(500).optional(),
});

// ─── Bank Transaction schemas ─────────────────────────────────────────────
export const MatchBankTransactionSchema = z.object({
  transactionId: z.string().uuid(),
  bookingId: z.string().uuid(),
  overflowAction: z.enum(['mileage', 'refund']).optional(),
});

export const UndoBankTransactionSchema = z.object({
  transactionId: z.string().uuid(),
});

export const SplitBankTransactionSchema = z.object({
  transactionId: z.string().uuid(),
  splits: z.array(z.object({
    bookingId: z.string().uuid(),
    amount: z.number().positive(),
  })).min(1),
});

// ─── Affiliate schemas ─────────────────────────────────────────────────────
export const CreateAffiliateSchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  referral_code: z.string().min(1).max(50),
  payout_type: z.enum(['PERSONAL', 'CORPORATE']).optional(),
  bank_info: z.string().optional().nullable(),
  memo: z.string().optional().nullable(),
});

export const UpdateAffiliateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  payout_type: z.enum(['PERSONAL', 'CORPORATE']).optional(),
  bank_info: z.string().optional().nullable(),
  memo: z.string().optional().nullable(),
  commission_rate: z.number().min(0).max(0.5).optional(),
  is_active: z.boolean().optional(),
  landing_intro: z.string().max(4000).optional().nullable(),
  landing_pick_package_ids: z.array(z.string().uuid()).max(12).optional(),
  landing_video_url: z.string().url().optional().nullable(),
});

// ─── Billing schemas ──────────────────────────────────────────────────────
export const ChargeSchema = z.object({
  tenant_id: z.string(),
  amount_krw: z.number().positive(),
  order_id: z.string().optional(),
  order_name: z.string().optional(),
});

// ─── Secure Chat schemas ──────────────────────────────────────────────────
export const UnmaskChatSchema = z.object({
  booking_id: z.string().uuid(),
});

// Helper: Validate and return typed data
export function validateRequest<T>(schema: z.ZodSchema<T>, data: unknown): { data: T; error: null } | { data: null; error: string } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { data: result.data, error: null };
  }
  return { data: null, error: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ') };
}
