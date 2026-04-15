const BOT_UA_PATTERNS =
  /(googlebot|bingbot|baiduspider|yandex|duckduckbot|slurp|sogou|exabot|facebot|facebookexternalhit|ia_archiver|curl\/|wget\/|python-requests|python-urllib|go-http-client|httpclient|node-fetch|axios\/|okhttp|java\/|scrapy|phantomjs|headlesschrome|puppeteer|playwright|selenium)/i;

export function isBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  if (userAgent.length < 10) return true;
  return BOT_UA_PATTERNS.test(userAgent);
}
