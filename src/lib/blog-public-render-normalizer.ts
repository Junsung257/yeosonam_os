function normalizeExactBlockSignature(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeExactLongBlocks(html: string): string {
  const seen = new Set<string>();
  return html.replace(/<(p|li)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (match, _tag, _attrs, body) => {
    const signature = normalizeExactBlockSignature(body);
    if (signature.length < 45) return match;
    if (seen.has(signature)) return '';
    seen.add(signature);
    return match;
  });
}

function removeExcessiveHorizontalRules(html: string): string {
  const count = (html.match(/<hr\b[^>]*\/?>/gi) ?? []).length;
  return count >= 3 ? html.replace(/<hr\b[^>]*\/?>/gi, '') : html;
}

const NON_DESCRIPTIVE_IMAGE_ALT_RE = /(?:여행\s*준비(?:\s*장면)?|비용\s*확인(?:\s*장면)?|월별\s*날씨(?:\s*확인)?|10초\s*판단|포함\s*\/\s*불포함|일정\s*체감|예산\s*체크(?:\s*장면)?)$/u;

export interface PublicBlogBodySanitizeOptions {
  imageAltPrefix?: string | null;
}

function removeNonDescriptiveImageAlts(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => tag.replace(
    /\balt\s*=\s*(["'])(.*?)\1/i,
    (attribute, quote: string, alt: string) => (
      NON_DESCRIPTIVE_IMAGE_ALT_RE.test(alt.replace(/\s+/g, ' ').trim())
        ? `alt=${quote}${quote}`
        : attribute
    ),
  ));
}

function normalizeImageAltText(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeImageAltAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function lastRenderedHeading(html: string): string {
  const matches = [...html.matchAll(/<h[2-6]\b[^>]*>([\s\S]*?)<\/h[2-6]>/gi)];
  return normalizeImageAltText(matches.at(-1)?.[1] ?? '');
}

function ensureDescriptiveImageAlts(html: string, imageAltPrefix: string | null | undefined): string {
  const prefix = normalizeImageAltText(imageAltPrefix ?? '');
  if (!prefix) return html;

  return html.replace(/<img\b[^>]*>/gi, (tag, offset: number, source: string) => {
    const altMatch = tag.match(/\balt\s*=\s*(["'])(.*?)\1/i);
    const currentAlt = normalizeImageAltText(altMatch?.[2] ?? '');
    if (currentAlt) return tag;

    const heading = lastRenderedHeading(source.slice(0, offset));
    const context = heading && !heading.toLowerCase().includes(prefix.toLowerCase())
      ? `${prefix} ${heading}`
      : heading || prefix;
    const fallbackAlt = `${context} 이미지`.slice(0, 160);
    const escapedAlt = escapeImageAltAttribute(fallbackAlt);
    if (altMatch) {
      return tag.replace(altMatch[0], `alt="${escapedAlt}"`);
    }
    return tag.replace(/\s*\/?>$/, (closing) => ` alt="${escapedAlt}"${closing}`);
  });
}

function normalizeHeadingTextForCompare(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|\u00a0/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[^\p{L}\p{N}\uac00-\ud7a3]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function stripPublicDuplicateBodyTitleHeading(html: string, pageTitle: string): string {
  const titleSignature = normalizeHeadingTextForCompare(pageTitle);
  if (!titleSignature) return html;

  return html.replace(
    /^\s*<h2\b([^>]*)>([\s\S]*?)<\/h2>\s*/i,
    (match, attrs: string, headingHtml: string) => {
      const headingSignature = normalizeHeadingTextForCompare(headingHtml);
      if (!headingSignature) return match;
      const isSameTitle =
        headingSignature === titleSignature
        || headingSignature.includes(titleSignature)
        || titleSignature.includes(headingSignature);
      return isSameTitle ? '' : `<h2${attrs}>${headingHtml}</h2>`;
    },
  );
}

export function sanitizePublicBlogBodyHtml(
  html: string,
  options: PublicBlogBodySanitizeOptions = {},
): string {
  const sanitized = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(del|s|strike)\b[^>]*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|svg|math|base|link|meta|form|input|button|textarea|select)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|svg|math|base|link|meta|form|input|button|textarea|select)\b[^>]*\/?>/gi, '')
    .replace(/\s(?:on[a-z]+|srcdoc)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src)\s*=\s*(["']?)\s*(javascript:|data:text\/html|vbscript:)[\s\S]*?\2/gi, '')
    .replace(/\s(class|id)\s*=\s*(["'])([^"']{300,})\2/gi, '')
    .replace(/<h1\b[^>]*>\s*(?:&nbsp;|\u00a0|<br\s*\/?>|\s)*<\/h1>/gi, '')
    .replace(/<h1\b([^>]*)>/gi, '<h2$1>')
    .replace(/<\/h1>/gi, '</h2>');
  const normalized = removeNonDescriptiveImageAlts(removeExcessiveHorizontalRules(sanitized));
  return dedupeExactLongBlocks(ensureDescriptiveImageAlts(normalized, options.imageAltPrefix));
}
