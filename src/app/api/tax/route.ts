import { GET as getFinanceTax } from '@/app/api/admin/finance/tax/route';

// Compatibility route. Finance Center V3 owns the shared tax/evidence read model.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = getFinanceTax;
