import { getSecret } from './secret-registry';

export type NaverSearchTransportV4 = 'api_hub' | 'developers_legacy';
export type NaverSearchVerticalV4 = 'blog' | 'webkr';

export interface NaverSearchRequestV4 {
  transport: NaverSearchTransportV4;
  url: string;
  headers: Record<string, string>;
}

export function buildNaverSearchRequestsV4(input: {
  query: string;
  vertical: NaverSearchVerticalV4;
  display?: number;
  env?: Record<string, string | undefined>;
}): NaverSearchRequestV4[] {
  const readCredential = (key: 'NAVER_API_HUB_CLIENT_ID' | 'NAVER_API_HUB_CLIENT_SECRET' | 'NAVER_CLIENT_ID' | 'NAVER_CLIENT_SECRET'): string => (
    String(input.env ? input.env[key] || '' : getSecret(key) || '').trim()
  );
  const display = Math.max(1, Math.min(100, Math.trunc(input.display ?? 10)));
  const suffix = `query=${encodeURIComponent(input.query)}&display=${display}&sort=sim`;
  const requests: NaverSearchRequestV4[] = [];
  const hubId = readCredential('NAVER_API_HUB_CLIENT_ID');
  const hubSecret = readCredential('NAVER_API_HUB_CLIENT_SECRET');
  if (hubId && hubSecret) {
    requests.push({
      transport: 'api_hub',
      url: `https://naverapihub.apigw.ntruss.com/search/v1/${input.vertical}?${suffix}`,
      headers: {
        'X-NCP-APIGW-API-KEY-ID': hubId,
        'X-NCP-APIGW-API-KEY': hubSecret,
      },
    });
  }
  const legacyId = readCredential('NAVER_CLIENT_ID');
  const legacySecret = readCredential('NAVER_CLIENT_SECRET');
  if (legacyId && legacySecret) {
    requests.push({
      transport: 'developers_legacy',
      url: `https://openapi.naver.com/v1/search/${input.vertical}.json?${suffix}`,
      headers: {
        'X-Naver-Client-Id': legacyId,
        'X-Naver-Client-Secret': legacySecret,
      },
    });
  }
  return requests;
}

export async function fetchNaverSearchV4<T>(input: {
  query: string;
  vertical: NaverSearchVerticalV4;
  display?: number;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<{ payload: T; transport: NaverSearchTransportV4 }> {
  const requests = buildNaverSearchRequestsV4(input);
  if (requests.length === 0) throw new Error('naver_search_credentials_missing');
  const fetchImpl = input.fetchImpl ?? fetch;
  const failures: string[] = [];
  for (const request of requests) {
    try {
      const response = await fetchImpl(request.url, {
        headers: request.headers,
        signal: AbortSignal.timeout(input.timeoutMs ?? 10_000),
      });
      if (!response.ok) {
        failures.push(`${request.transport}:http_${response.status}`);
        continue;
      }
      return { payload: await response.json() as T, transport: request.transport };
    } catch (error) {
      failures.push(`${request.transport}:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`naver_search_all_transports_failed:${failures.join(';')}`);
}
