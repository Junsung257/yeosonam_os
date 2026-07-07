export interface BlogFinalCustomerSurfaceInput {
  markdown: string;
  destination?: string | null;
  primaryKeyword?: string | null;
  slug?: string | null;
  title?: string | null;
}

export interface BlogFinalCustomerSurfaceResult {
  markdown: string;
  changed: boolean;
  changes: string[];
}

function cleanLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[_|()[\]{}"'`~!@#$%^&*+=<>]/g, ' ')
    .replace(/\b(?:blog|guide|travel|weather|packing|budget|itinerary|value|review)\b/gi, ' ')
    .replace(/\d{4,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || /^(?:현지|여행|여행지|가이드|준비|정보|상품)$/i.test(cleaned)) return null;
  return cleaned.length > 24 ? cleaned.slice(0, 24).trim() : cleaned;
}

function inferDestination(input: BlogFinalCustomerSurfaceInput): string | null {
  return cleanLabel(input.destination)
    || cleanLabel(input.primaryKeyword?.split(/\s+/)[0])
    || cleanLabel(input.title?.split(/\s+/)[0])
    || cleanLabel(input.slug?.replace(/[-_]+/g, ' '));
}

function hasKoreanBatchim(value: string): boolean {
  const chars = Array.from(value.trim()).reverse();
  const lastHangul = chars.find((char) => {
    const code = char.charCodeAt(0);
    return code >= 0xac00 && code <= 0xd7a3;
  });
  if (!lastHangul) return false;
  return ((lastHangul.charCodeAt(0) - 0xac00) % 28) > 0;
}

function stripMarkup(markdown: string): string {
  return markdown
    .replace(/!\[[^\]\n]*]\([^)]+\)/g, ' ')
    .replace(/\[[^\]\n]+]\([^)]+\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/[#*_`>|=[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function repairBrokenMarkdownUrlResidue(markdown: string): { markdown: string; changed: boolean } {
  let next = markdown;
  for (let index = 0; index < 4; index += 1) {
    next = next.replace(/\]\(([^)\n]*)\n{1,2}([^)\n]*)\)/g, (_match, left: string, right: string) => {
      return `](${String(left || '').trim()}${String(right || '').trim()})`;
    });
  }
  next = next
    .split('\n')
    .filter((line) => !/^\s*(?:utm_|medium=|campaign=|content=|source=)[A-Za-z0-9_=&%.-]+\)?\s*$/.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
  return { markdown: next, changed: next !== markdown };
}

function dedupeHashtags(markdown: string): { markdown: string; changed: boolean } {
  const next = markdown
    .split('\n')
    .map((line) => {
      const tags = line.match(/#[가-힣A-Za-z0-9_]+/g);
      if (!tags || tags.length < 3) return line;
      const seen = new Set<string>();
      const unique = tags.filter((tag) => {
        const key = tag.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 12);
      if (unique.length === tags.length) return line;
      return unique.join(' ');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
  return { markdown: next, changed: next !== markdown };
}

function repairDestinationSurface(markdown: string, destination: string | null): { markdown: string; changed: boolean } {
  if (!destination) return { markdown, changed: false };
  const topicParticle = hasKoreanBatchim(destination) ? '은' : '는';
  const next = markdown
    .replace(/\n+여소남의\s*여행지\s*추천\s*상품\s*미리보기[\s\S]*?(?=\n\n(?:현지에서의|#|##|###|---|$))/g, '\n\n')
    .replace(/여소남에서는\s*현재\s*\d+개의\s*현지\s*관련\s*상품[\s\S]*?\n\n/g, '')
    .replace(/상품\s*가격\s*변동_PKG[^\s)\n]*/g, '예약 시점별 가격 변동 상품')
    .replace(/현지\s*관련\s*상품/g, `${destination} 관련 상품`)
    .replace(/현지\s*관련\s*예약\s*신호/g, `${destination} 예약 신호`)
    .replace(/현지의\s*매력/g, `${destination}의 매력`)
    .replace(/현지에서의\s*식사/g, `${destination}에서의 식사`)
    .replace(/여행\s*정보를\s*볼\s*때/g, `${destination} 정보를 볼 때`)
    .replace(/현지\s+현지/g, destination)
    .replace(/현지은/g, `${destination}${topicParticle}`)
    .replace(/현지는/g, `${destination}${topicParticle}`)
    .replace(/현지(?=\s*(?:월별\s*날씨|날씨와\s*옷차림|날씨|옷차림|우기|건기|일정|이동|비용|결제|준비|준비물|예약|체크|공항|시내|정보|여행|지역))/g, destination)
    .replace(/여행지(?=\s*(?:월별\s*날씨|날씨와\s*옷차림|날씨|옷차림|우기|건기|일정|이동|비용|결제|준비|준비물|예약|체크|공항|시내|정보|여행|지역))/g, destination)
    .replace(new RegExp(`${destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+${destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'g'), destination)
    .replace(/,\s*에서\s*가치\s*있는\s*여행을\s*위한/g, ' 등 여행에 필요한')
    .replace(/\.\s*에서\s*/g, '. ')
    .replace(/있편입니다/g, '있는 편입니다')
    .replace(/\n{3,}/g, '\n\n');
  return { markdown: next, changed: next !== markdown };
}

function splitParagraphWalls(markdown: string): { markdown: string; changed: boolean } {
  const splitText = (text: string): string => {
    const plain = stripMarkup(text);
    if (Array.from(plain).length <= 360) return text;
    if (/\[[^\]\n]+]\([^)]+/.test(text)) return text;
    return text
      .replace(/([.!?。！？])\s+/g, '$1\n\n')
      .replace(/((?:입니다|합니다|됩니다|주세요|하세요|이에요|예요|습니다|니다|세요|해요)[.!?。！？]?)\s+/g, '$1\n\n')
      .replace(/\n{3,}/g, '\n\n');
  };

  const next = markdown
    .split(/\n{2,}/)
    .map((paragraph) => {
      const trimmed = paragraph.trim();
      if (!trimmed || /^\s*\||^!\[[^\]]*]\(/.test(trimmed)) return paragraph;
      if (/^\s*[-*]\s+\[[^\]\n]+]\([^)]+\)\s*$/.test(trimmed)) return paragraph;
      if (/^#{1,6}\s/.test(trimmed)) {
        const lines = paragraph.split('\n');
        const heading = lines[0] ?? '';
        const rest = lines.slice(1).join('\n').trim();
        if (!rest) return paragraph;
        return `${heading.trim()}\n\n${splitText(rest)}`;
      }
      return splitText(paragraph);
    })
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n');
  return { markdown: next, changed: next !== markdown };
}

function pruneLeadProse(markdown: string, input: BlogFinalCustomerSurfaceInput): { markdown: string; changed: boolean } {
  const lines = markdown.split('\n');
  const h1Index = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  if (h1Index < 0) return { markdown, changed: false };

  const firstSectionIndex = lines.findIndex((line, index) => {
    if (index <= h1Index) return false;
    const trimmed = line.trim();
    return /^#{2,6}\s+\S/.test(trimmed) || /^!\[/.test(trimmed) || /^\|.*\|$/.test(trimmed);
  });
  if (firstSectionIndex < 0) return { markdown, changed: false };
  const leadEnd = firstSectionIndex >= 0 ? firstSectionIndex : Math.min(lines.length, h1Index + 8);
  const leadLines = lines
    .slice(h1Index + 1, leadEnd)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^[-*]\s+/.test(line) && !/\[[^\]\n]+]\([^)]+\)/.test(line));
  if (leadLines.length <= 1) return { markdown, changed: false };

  const firstLead = leadLines[0] ?? '';
  const firstPlain = stripMarkup(firstLead);
  const hasAnswerShape = firstPlain.length >= 70 &&
    /[?？]|먼저|확인|비교|준비|비용|가격|만원|시간|날씨|환전|카드|현금|입국|여권|\d/.test(firstPlain);
  const destination = inferDestination(input) || '여행';
  const lead = hasAnswerShape
    ? firstLead
    : `${destination}, 먼저 무엇을 확인해야 할까요? 일정, 비용, 이동 조건을 함께 비교하면 출발 전 바뀔 수 있는 조건을 줄일 수 있습니다.`;

  const next = [
    ...lines.slice(0, h1Index + 1),
    '',
    lead,
    '',
    ...lines.slice(leadEnd),
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { markdown: next, changed: next !== markdown };
}

function dedupeLeadSentences(markdown: string): { markdown: string; changed: boolean } {
  const lines = markdown.split('\n');
  const h1Index = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  if (h1Index < 0) return { markdown, changed: false };
  const leadEnd = lines.findIndex((line, index) => {
    if (index <= h1Index) return false;
    const trimmed = line.trim();
    return /^#{2,6}\s+\S/.test(trimmed) || /^!\[/.test(trimmed) || /^\|.*\|$/.test(trimmed);
  });
  if (leadEnd < 0) return { markdown, changed: false };
  const endIndex = leadEnd;
  const seen = new Set<string>();
  for (let index = h1Index + 1; index < endIndex; index += 1) {
    const trimmed = (lines[index] ?? '').trim();
    if (!trimmed || /^[-*]\s+/.test(trimmed) || /\[[^\]\n]+]\([^)]+\)/.test(trimmed)) continue;
    const sentences = trimmed.split(/(?<=[.!?。！？])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
    const unique = sentences.filter((sentence) => {
      const key = sentence.replace(/[^\p{L}\p{N}가-힣]+/gu, '').replace(/^(?:유럽|동남아|여행지|현지)/, '').trim();
      if (key.length < 18) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    lines[index] = unique.join(' ');
  }
  const next = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { markdown: next, changed: next !== markdown };
}

export function repairBlogFinalCustomerSurface(input: BlogFinalCustomerSurfaceInput): BlogFinalCustomerSurfaceResult {
  const changes: string[] = [];
  let markdown = input.markdown || '';
  const apply = (name: string, result: { markdown: string; changed: boolean }) => {
    if (result.changed) {
      markdown = result.markdown;
      changes.push(name);
    }
  };

  const destination = inferDestination(input);
  apply('repair_broken_markdown_url_residue', repairBrokenMarkdownUrlResidue(markdown));
  apply('dedupe_hashtags', dedupeHashtags(markdown));
  apply('repair_destination_surface', repairDestinationSurface(markdown, destination));
  apply('split_paragraph_walls', splitParagraphWalls(markdown));
  apply('dedupe_lead_sentences', dedupeLeadSentences(markdown));
  apply('prune_lead_prose', pruneLeadProse(markdown, input));
  apply('repair_destination_surface_final', repairDestinationSurface(markdown, destination));

  markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();
  return {
    markdown,
    changed: markdown !== input.markdown,
    changes,
  };
}
