import { eventType, Inngest } from 'inngest';
import { z } from 'zod';

const tenantIdSchema = z.string().trim().min(1).max(128);

export const marketingTenantRunEvent = eventType('marketing/tenant.run', {
  schema: z.object({
    tenantId: tenantIdSchema,
    tenantName: z.string().trim().min(1).max(200),
    runDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  }).strict(),
});

export const billingChargeTenantEvent = eventType('billing/charge.tenant', {
  schema: z.object({
    tenantId: tenantIdSchema,
    amount: z.number().int().positive().max(100_000_000),
    billingPeriod: z.string().regex(/^\d{4}-\d{2}-01$/u),
  }).strict(),
});

export const inngest = new Inngest({
  id: 'yeosonam-os',
  name: '여소남 OS',
});
