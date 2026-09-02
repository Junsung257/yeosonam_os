import { inngest } from './client';
import { dailyMarketingFn } from './functions/daily-marketing';
import { tenantMarketingFn } from './functions/tenant-marketing';
import { monthlyBillingFn } from './functions/monthly-billing';
import { tenantBillingFn } from './functions/tenant-billing';
import { blogAutopilotV4Fn } from './functions/blog-autopilot-v4';

export {
  inngest,
  dailyMarketingFn,
  tenantMarketingFn,
  monthlyBillingFn,
  tenantBillingFn,
  blogAutopilotV4Fn,
};

/** Single registration list shared by the serve route and authenticated diagnostics. */
export const inngestFunctions = [
  dailyMarketingFn,
  tenantMarketingFn,
  monthlyBillingFn,
  tenantBillingFn,
  blogAutopilotV4Fn,
] as const;

export const MINIMUM_INNGEST_FUNCTION_COUNT = 5;
