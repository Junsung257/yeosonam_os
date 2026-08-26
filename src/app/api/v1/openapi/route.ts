import { apiResponse } from '@/lib/api-response';
import { createV1OpenApiDocument } from '@/lib/api-contracts/v1';

export const dynamic = 'force-static';
export const revalidate = 3_600;

export async function GET() {
  return apiResponse(createV1OpenApiDocument(), {
    cacheSeconds: 3_600,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
