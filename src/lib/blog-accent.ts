import { ensureRequiredBlogDecisionBlocks } from './blog-required-structure';

const DOUBLE_TILDE_SENTINEL = 'YS_DOUBLE_TILDE_SENTINEL';
const CODE_SENTINEL_PREFIX = 'YS_CODE_CHUNK_';
const MAX_NUM_ACCENTS = 35;

const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;
const PRICE_UNIT = String.raw`(?:만원|천원|원|달러|USD|EUR|JPY|THB)`;
const DATE_UNIT = String.raw`(?:년|월|일)`;
const DURATION_UNIT = String.raw`(?:박|분|시간|주)`;
const WEATHER_UNIT = String.raw`(?:℃|도|mm|%)`;
const NUM_ACCENT_RE = new RegExp(
  [
    String.raw`\$ ?${NUM}`,
    String.raw`${NUM} ?${PRICE_UNIT}`,
    String.raw`${NUM} ?(?:${PRICE_UNIT})? ?\u2013 ?${NUM} ?${PRICE_UNIT}`,
    String.raw`${NUM} ?${DATE_UNIT}`,
    String.raw`${NUM} ?(?:${DATE_UNIT})? ?\u2013 ?${NUM} ?${DATE_UNIT}`,
    String.raw`${NUM} ?박 ?${NUM} ?일`,
    String.raw`${NUM} ?${DURATION_UNIT}`,
    String.raw`${NUM} ?(?:${DURATION_UNIT})? ?\u2013 ?${NUM} ?${DURATION_UNIT}`,
    String.raw`${NUM} ?${WEATHER_UNIT}`,
    String.raw`${NUM} ?(?:${WEATHER_UNIT})? ?\u2013 ?${NUM} ?${WEATHER_UNIT}`,
  ].join('|'),
  'g',
);

export function normalizeRangeDashes(md: string): string {
  if (!md) return md;

  const codeChunks: string[] = [];
  let out = md.replace(/~~/g, DOUBLE_TILDE_SENTINEL);

  out = out.replace(/```[\s\S]*?```/g, (match) => {
    codeChunks.push(match);
    return `${CODE_SENTINEL_PREFIX}${codeChunks.length - 1}__`;
  });
  out = out.replace(/`[^`\n]+`/g, (match) => {
    codeChunks.push(match);
    return `${CODE_SENTINEL_PREFIX}${codeChunks.length - 1}__`;
  });

  out = out.replace(/~/g, '\u2013');

  out = out.replace(new RegExp(`${CODE_SENTINEL_PREFIX}(\\d+)__`, 'g'), (_match, index) => {
    return codeChunks[Number(index)] || '';
  });
  return out.replace(new RegExp(DOUBLE_TILDE_SENTINEL, 'g'), '~~');
}

export function applyMarkdownAccents(md: string): string {
  if (!md) return md;

  let out = normalizeRangeDashes(ensureRequiredBlogDecisionBlocks(md));

  // The page template owns the only H1. Body H1s become H2s.
  out = out.replace(/^# /gm, '## ');

  let h2Count = 0;
  let h3Count = 0;
  out = out.replace(/^(#{2,3})\s+(.+)$/gm, (match, hashes, title) => {
    if (hashes === '##') {
      h2Count += 1;
      if (h2Count > 10) {
        h3Count += 1;
        return `### ${title}`;
      }
      return match;
    }

    h3Count += 1;
    if (h3Count > 20) return `#### ${title}`;
    return match;
  });

  h3Count = 0;
  out = out.replace(/^###\s+(.+)$/gm, (match, title) => {
    h3Count += 1;
    if (h3Count > 20) return `#### ${title}`;
    return match;
  });

  // Legacy ==highlight== syntax is no longer rendered as a marker.
  out = out.replace(/==([^=\n]{1,120}?)==/g, '$1');

  out = out.replace(/:::tip\s*\n([\s\S]*?)\n:::/g, (_match, body) => {
    return `\n<aside class="tip">\n\n${body.trim()}\n\n</aside>\n`;
  });
  out = out.replace(/:::tip\s+(.+?)\s*:::/g, (_match, body) => `<aside class="tip">${body}</aside>`);

  return out;
}

function wrapPlainTextNumAccents(segment: string, state: { count: number }): string {
  return segment.replace(NUM_ACCENT_RE, (match) => {
    if (state.count >= MAX_NUM_ACCENTS) return match;
    state.count += 1;
    return `<strong class="num">${match}</strong>`;
  });
}

export function applyHtmlAccents(html: string): string {
  if (!html) return html;

  const parts: string[] = [];
  const state = { count: 0 };
  let index = 0;
  const lowerHtml = html.toLowerCase();
  const skipTags = ['a', 'code', 'pre', 'script', 'style', 'img', 'strong', 'mark'];

  while (index < html.length) {
    if (html[index] !== '<') {
      const nextTag = html.indexOf('<', index);
      const segment = nextTag === -1 ? html.slice(index) : html.slice(index, nextTag);
      parts.push(wrapPlainTextNumAccents(segment, state));
      index = nextTag === -1 ? html.length : nextTag;
      continue;
    }

    const openTagMatch = lowerHtml.slice(index).match(/^<([a-z0-9-]+)(?:\s|>|\/)/);
    if (!openTagMatch) {
      const end = html.indexOf('>', index);
      if (end === -1) {
        parts.push(html.slice(index));
        break;
      }
      parts.push(html.slice(index, end + 1));
      index = end + 1;
      continue;
    }

    const tagName = openTagMatch[1];
    const tagEnd = html.indexOf('>', index);
    if (tagEnd === -1) {
      parts.push(html.slice(index));
      break;
    }

    if (!skipTags.includes(tagName) || lowerHtml[index + 1] === '/') {
      parts.push(html.slice(index, tagEnd + 1));
      index = tagEnd + 1;
      continue;
    }

    if (tagName === 'img' || html[tagEnd - 1] === '/') {
      parts.push(html.slice(index, tagEnd + 1));
      index = tagEnd + 1;
      continue;
    }

    const closeTag = `</${tagName}>`;
    const closeIndex = lowerHtml.indexOf(closeTag, tagEnd + 1);
    if (closeIndex === -1) {
      parts.push(html.slice(index, tagEnd + 1));
      index = tagEnd + 1;
      continue;
    }

    parts.push(html.slice(index, closeIndex + closeTag.length));
    index = closeIndex + closeTag.length;
  }

  return parts.join('');
}
