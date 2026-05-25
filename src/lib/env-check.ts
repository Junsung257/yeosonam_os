/**
 * 환경변수 누락 체크 — dev 서버 시작 시 한 번 실행.
 *
 * 중요 크론/파이프라인이 의존하는 환경변수가 누락되면
 * 조용히 스킵되는 대신 개발자에게 명확히 알린다.
 *
 * 사용: next.config.js 또는 layout.tsx 최상단에서 import
 */

const CRITICAL_ENV = [
  'SERPAPI_KEY',
  'BAND_RSS_URL',
  'TWITTER_BEARER_TOKEN',
  'NAVER_CLIENT_ID',
  'NAVER_CLIENT_SECRET',
  'NAVER_CAFE_ID',
  'NEXT_PUBLIC_GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'SLACK_WEBHOOK_URL',
  'CRON_SECRET',
] as const;

const WARN_ENV = [
  'AD_FLAG_UP_BID_FACTOR',
  'AD_OFFPEAK_BID_FACTOR',
  'AD_MIN_BID_KRW',
] as const;

export function checkMissingEnvVars(): { missing: string[]; warnings: string[] } {
  if (typeof process === 'undefined') return { missing: [], warnings: [] };

  const missing: string[] = [];
  const warnings: string[] = [];

  for (const key of CRITICAL_ENV) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  for (const key of WARN_ENV) {
    if (!process.env[key]) {
      warnings.push(key);
    }
  }

  if (missing.length > 0) {
    console.warn(
      `\n⚠️  [env-check] 다음 ${missing.length}개 중요 환경변수가 설정되지 않았습니다:\n` +
        missing.map((k) => `    - ${k}`).join('\n') +
        `\n   관련 크론/파이프라인이 조용히 스킵됩니다.\n`
    );
  }

  if (warnings.length > 0) {
    console.warn(
      `\n📋 [env-check] 다음 ${warnings.length}개 환경변수가 기본값으로 동작합니다:\n` +
        warnings.map((k) => `    - ${k}`).join('\n') + '\n'
    );
  }

  return { missing, warnings };
}
