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

export function sanitizePublicBlogBodyHtml(html: string): string {
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
  return dedupeExactLongBlocks(removeExcessiveHorizontalRules(sanitized));
}
