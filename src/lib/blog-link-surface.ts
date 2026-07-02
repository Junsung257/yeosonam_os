const PUBLIC_BLOG_ORIGIN = 'https://www.yeosonam.com';
const NON_PUBLIC_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

function normalizeInternalUrl(href: string, origin = PUBLIC_BLOG_ORIGIN): string {
  const trimmed = href.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (!NON_PUBLIC_HOSTS.has(host) && host !== 'yeosonam.com' && host !== 'www.yeosonam.com') {
      return trimmed;
    }

    const publicUrl = new URL(origin);
    parsed.protocol = publicUrl.protocol;
    parsed.hostname = publicUrl.hostname;
    parsed.port = publicUrl.port;
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeLinkLabel(label: string): string {
  return label.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function canonicalizeBlogPublicLinks(markdownOrHtml: string, origin = PUBLIC_BLOG_ORIGIN): string {
  const normalizedBrokenLabels = markdownOrHtml.replace(
    /(?<!!)\[([^\]\n]{1,120})\n{2,}([^\]]{1,160})]\(((?:https?:\/\/|\/)[^)]+)\)/g,
    (_match, first: string, second: string, href: string) => `[${normalizeLinkLabel(`${first} ${second}`)}](${href.trim()})`,
  );

  return normalizedBrokenLabels
    .replace(/(?<!!)\[([\s\S]{1,240}?)]\((https?:\/\/[^)\s]+(?:\s+"[^"]*")?)\)/g, (match, label: string, rawHref: string) => {
      const titleMatch = rawHref.match(/^(\S+)(\s+"[^"]*")$/);
      const href = titleMatch ? titleMatch[1] : rawHref;
      const title = titleMatch ? titleMatch[2] : '';
      const cleanLabel = normalizeLinkLabel(label);
      const normalizedHref = normalizeInternalUrl(href, origin);
      if (normalizedHref === href && cleanLabel === label) return match;
      return `[${cleanLabel}](${normalizedHref}${title})`;
    })
    .replace(/(<a\b[^>]*\bhref=["'])(https?:\/\/[^"']+)(["'][^>]*>)/gi, (match, prefix: string, href: string, suffix: string) => {
      const normalizedHref = normalizeInternalUrl(href, origin);
      return normalizedHref === href ? match : `${prefix}${escapeHtmlAttribute(normalizedHref)}${suffix}`;
    });
}

export function normalizeLiteralMarkdownLinksForHtml(markdownOrHtml: string, origin = PUBLIC_BLOG_ORIGIN): string {
  return markdownOrHtml.replace(
    /(?<!!)\[([^\]\n]{1,160})]\(((?:https?:\/\/|\/)[^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_match, label: string, href: string) => {
      const cleanLabel = normalizeLinkLabel(label);
      const normalizedHref = normalizeInternalUrl(href, origin);
      if (!cleanLabel || !normalizedHref) return cleanLabel || '';
      return `<a href="${escapeHtmlAttribute(normalizedHref)}">${cleanLabel}</a>`;
    },
  );
}

export function repairBlogLinkSurface(markdownOrHtml: string, origin = PUBLIC_BLOG_ORIGIN): { text: string; changed: boolean } {
  const before = markdownOrHtml;
  const text = normalizeLiteralMarkdownLinksForHtml(canonicalizeBlogPublicLinks(markdownOrHtml, origin), origin);
  return { text, changed: text !== before };
}
