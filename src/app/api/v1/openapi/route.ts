import { apiResponse } from '@/lib/api-response';
import document from '../../../../../docs/api/v1-openapi.json';

// Vercel's output tracing expects a lambda for this API route. The response
// remains CDN-cacheable through `cacheSeconds`; forcing a dynamic handler keeps
// the OpenAPI document available without relying on an ISR artifact mapping.
export const dynamic = 'force-dynamic';
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
