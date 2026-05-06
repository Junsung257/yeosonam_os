/**
 * 네이버 밴드 RSS 피드 파서
 * 공개 밴드의 RSS 엔드포인트에서 게시글을 가져와 구조화된 객체로 반환합니다.
 * Selenium 없음, 봇 감지 없음 — 완전한 공개 API 방식.
 */

export interface BandPost {
  title: string;
  url: string;
  content: string;
  publishedAt: Date;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .trim();
}

function unwrapCdata(s: string): string {
  const t = s.trim();
  if (t.startsWith('<![CDATA[') && t.endsWith(']]>')) return t.slice(9, -3).trim();
  return t;
}

function extractBetween(text: string, open: string, close: string): string {
  const start = text.indexOf(open);
  if (start === -1) return '';
  const end = text.indexOf(close, start + open.length);
  if (end === -1) return '';
  return text.slice(start + open.length, end).trim();
}

const ITEM_OPEN  = '<item>';
const ITEM_CLOSE = '</item>';

function parseRssItems(xml: string): BandPost[] {
  const items: BandPost[] = [];
  let cursor = 0;

  while (true) {
    const itemStart = xml.indexOf(ITEM_OPEN, cursor);
    if (itemStart === -1) break;
    const itemEnd = xml.indexOf(ITEM_CLOSE, itemStart);
    if (itemEnd === -1) break;

    const chunk = xml.slice(itemStart + ITEM_OPEN.length, itemEnd);

    const title   = stripHtml(unwrapCdata(extractBetween(chunk, '<title>', '</title>')));
    const link    = unwrapCdata(extractBetween(chunk, '<link>', '</link>')).trim();
    const rawDesc = unwrapCdata(extractBetween(chunk, '<description>', '</description>'));
    const pubDate = extractBetween(chunk, '<pubDate>', '</pubDate>');

    if (title && link) {
      items.push({
        title,
        url: link,
        content: stripHtml(rawDesc),
        publishedAt: pubDate ? new Date(pubDate) : new Date(),
      });
    }

    cursor = itemEnd + ITEM_CLOSE.length;
  }

  return items;
}

export async function fetchBandRSS(bandRssUrl: string): Promise<BandPost[]> {
  const res = await fetch(bandRssUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FeedParser/1.0)' },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`밴드 RSS 응답 오류: ${res.status} ${res.statusText}`);
  }

  const xml = await res.text();
  return parseRssItems(xml);
}
