import { apiResponse } from '@/lib/api-response';
import document from '../../../../../docs/api/v1-openapi.json';

export const dynamic = 'force-static';
export const revalidate = 3_600;

export async function GET() {
  return apiResponse(document, {
    cacheSeconds: 3_600,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
