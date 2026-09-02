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

export const blogPipelineRequestedEvent = eventType('blog/pipeline.requested', {
  schema: z.object({
    queueId: z.string().uuid(),
    contentVersion: z.string().trim().min(1).max(128),
    // Inngest event schemas cannot use input/output transforms such as Zod
    // defaults. Producers must send the explicit mode for an auditable event.
    mode: z.enum(['generate_only', 'generate_and_publish']),
    requestedAt: z.string().datetime(),
  }).strict(),
});

export const inngest = new Inngest({
  id: 'yeosonam-os',
  name: '여소남 OS',
});
