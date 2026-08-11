export interface BlogSafePublishRepairV3Result {
  markdown: string;
  changed: boolean;
  changes: string[];
}

/**
 * Publication repair is deliberately syntax-only. It may not add facts,
 * numbers, experience language, sources, headings, FAQs, CTAs, or keywords.
 */
export function repairBlogPublishFormattingV3(markdown: string): BlogSafePublishRepairV3Result {
  const changes: string[] = [];
  let next = String(markdown || '');
  const apply = (name: string, value: string) => {
    if (value !== next) {
      next = value;
      changes.push(name);
    }
  };

  apply('normalized_line_endings', next.replace(/\r\n?/g, '\n'));
  apply('removed_unsafe_html', next
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ''));
  apply('removed_unsafe_markdown_links', next.replace(
    /\[([^\]\n]+)]\(\s*(?:javascript:|data:text\/html)[^)]+\)/gi,
    '$1',
  ));
  apply('repaired_broken_markdown_url_line', next.replace(
    /\]\((https?:\/\/[^)\s]+)\s*\n\s*([^)\s]+)\)/g,
    ']($1$2)',
  ));
  apply('normalized_trailing_whitespace', next
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n'));
  apply('normalized_blank_lines', next.replace(/\n{4,}/g, '\n\n\n'));

  return { markdown: next.trim(), changed: next.trim() !== markdown, changes };
}
