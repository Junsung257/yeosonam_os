import { serve } from 'inngest/next';
import { inngest, dailyMarketingFn, tenantMarketingFn, monthlyBillingFn, tenantBillingFn } from '@/inngest';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    dailyMarketingFn,
    tenantMarketingFn,
    monthlyBillingFn,
    tenantBillingFn,
  ],
});
