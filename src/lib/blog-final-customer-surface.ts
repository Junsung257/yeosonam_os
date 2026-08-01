import { repairMonthlyWeatherClothingTable } from './blog-generation-research';

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

const CHATTY_INFO_PARAGRAPH_RE =
  /(?:\uC548\uB155\uD558\uC138\uC694|hello)[,\s]*(?:\uC18C\uC911\uD55C\s*)?\uC5EC\uD589|\uC5EC\uD589\uC744\s*\uACC4\uD68D\uD558\uC2DC\uB294\s*(?:\uC5EC\uB7EC\uBD84|\uBD84\uB4E4)|\uAFB8\uAC19\uC740\s*\uC5EC\uD589|\uB354\uC5C6\uC774\s*\uC88B\uC9C0\uB9CC|\uAF3C\uAF3C\uD558\uAC8C\s*\uC815\uB9AC\uD574\s*\uB4DC\uB9BD\uB2C8\uB2E4/i;
const EMPTY_CTA_SENTENCE_RE =
  /(?:^|[.!?\n]\s*)(?:\uC9C0\uAE08\s*\uBC14\uB85C|\uC544\uB798|\uC5EC\uAE30)\s*(?:\uB97C|\uC744)?\s*(?:\uD074\uB9AD|\uB20C\uB7EC)\s*(?:\uD574|\uD558\uC5EC)?\s*(?:\uAFB8\uAC19\uC740|\uC990\uAC70\uC6B4|\uC644\uBCBD\uD55C)?\s*[^.\n]{0,80}(?:\uC2DC\uC791|\uD655\uC778|\uC0C1\uB2F4|\uC608\uC57D)(?:[.!?])?/gi;

function removeChattyInfoIntro(markdown: string): { markdown: string; changed: boolean } {
  const blocks = markdown.split(/\n{2,}/);
  let seenTextBlocks = 0;
  let changed = false;
  const kept = blocks.filter((block) => {
    const plain = stripMarkup(block);
    if (!plain) return true;
    seenTextBlocks += 1;
    if (!CHATTY_INFO_PARAGRAPH_RE.test(plain)) return true;
    changed = true;
    return false;
  });
  const next = kept.join('\n\n').replace(/\n{3,}/g, '\n\n');
  return { markdown: next, changed };
}

const GENERATED_INSTRUCTION_RESIDUE_RE =
  /(?:\((?:첫|두|세|네)\s*번째\)|(?:^|\s)(?:첫|두|세|네)\s*번째(?:\s|$))|이\s*섹션은\s*주로|구체적인\s*수치보다는|아래에서\s*소개해\s*드릴|각\s*섹션별로|위\s*내용을\s*바탕으로|본문에\s*삽입|고객님의\s*모든\s*여행/i;

function removeGeneratedInstructionResidue(markdown: string): { markdown: string; changed: boolean } {
  const blocks = markdown.split(/\n{2,}/);
  let changed = false;
  const kept = blocks
    .map((block) => {
      const plain = stripMarkup(block);
      if (!GENERATED_INSTRUCTION_RESIDUE_RE.test(plain)) return block;
      changed = true;
      if (plain.length <= 220 || /^#{1,6}\s/.test(block.trim())) return '';
      return block
        .split(/(?<=[.!?。！？])\s+/)
        .filter((sentence) => !GENERATED_INSTRUCTION_RESIDUE_RE.test(stripMarkup(sentence)))
        .join(' ')
        .trim();
    })
    .filter(Boolean);
  const next = kept.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  return { markdown: next, changed: changed && next !== markdown.trim() };
}

function dedupeRepeatedPlainParagraphs(markdown: string): { markdown: string; changed: boolean } {
  const seen = new Set<string>();
  let changed = false;
  const blocks = markdown.split(/\n{2,}/);
  const kept = blocks.filter((block) => {
    const trimmed = block.trim();
    if (
      !trimmed
      || /^#{1,6}\s/.test(trimmed)
      || /^!\[/.test(trimmed)
      || /^\s*\|/.test(trimmed)
      || /^\s*(?:[-*]|\d+\.)\s+/m.test(trimmed)
    ) {
      return true;
    }
    const key = stripMarkup(trimmed)
      .replace(/\d{1,4}(?:,\d{3})*/g, '{num}')
      .replace(/[^\p{L}\p{N}가-힣{}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
    if (key.length < 45) return true;
    if (seen.has(key)) {
      changed = true;
      return false;
    }
    seen.add(key);
    return true;
  });
  const next = kept.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  return { markdown: next, changed: changed && next !== markdown.trim() };
}

function dedupeRepeatedPlainSentences(markdown: string): { markdown: string; changed: boolean } {
  const seen = new Set<string>();
  let changed = false;
  const next = markdown
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (
        !trimmed
        || /^#{1,6}\s/.test(trimmed)
        || /^!\[/.test(trimmed)
        || /^\s*\|/.test(trimmed)
        || /^\s*(?:[-*]|\d+\.)\s+/m.test(trimmed)
      ) {
        return block;
      }
      const sentences = block.split(/(?<=[.!?。！？])\s+/);
      const kept: string[] = [];
      for (const sentence of sentences) {
        const key = stripMarkup(sentence)
          .replace(/\d{1,4}(?:,\d{3})*/g, '{num}')
          .replace(/[^\p{L}\p{N}\uac00-\ud7a3{}]+/gu, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (key.length >= 50 && seen.has(key)) {
          changed = true;
          continue;
        }
        if (key.length >= 50) seen.add(key);
        kept.push(sentence);
      }
      return kept.join(' ').trim();
    })
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { markdown: next, changed: changed && next !== markdown.trim() };
}

function headingLevel(line: string): number | null {
  const match = line.match(/^(#{2,6})\s+\S/);
  return match ? match[1].length : null;
}

function headingSignature(line: string): string {
  return stripMarkup(line)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\uac00-\ud7a3{}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function removeDuplicateHeadingSections(markdown: string): { markdown: string; changed: boolean } {
  const lines = markdown.split('\n');
  const seen = new Set<string>();
  const kept: string[] = [];
  let changed = false;

  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? '';
    const level = headingLevel(line);
    if (!level) {
      kept.push(line);
      index += 1;
      continue;
    }

    const signature = headingSignature(line);
    if (signature && seen.has(signature)) {
      changed = true;
      index += 1;
      while (index < lines.length) {
        const nextLevel = headingLevel(lines[index] ?? '');
        if (nextLevel && nextLevel <= level) break;
        index += 1;
      }
      continue;
    }

    if (signature) seen.add(signature);
    kept.push(line);
    index += 1;
  }

  const next = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { markdown: next, changed: changed && next !== markdown.trim() };
}

function removeRedundantTitleHeading(markdown: string, input: BlogFinalCustomerSurfaceInput): { markdown: string; changed: boolean } {
  const lines = markdown.split('\n');
  const h1Index = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  if (h1Index < 0) return { markdown, changed: false };

  const h1Sig = headingSignature(lines[h1Index] ?? '');
  const titleSig = input.title ? stripMarkup(input.title).toLowerCase().replace(/[^\p{L}\p{N}\uac00-\ud7a3{}]+/gu, ' ').replace(/\s+/g, ' ').trim() : '';
  let changed = false;

  for (let index = h1Index + 1; index < Math.min(lines.length, h1Index + 10); index += 1) {
    const line = lines[index] ?? '';
    if (!/^##\s+\S/.test(line.trim())) continue;
    const sig = headingSignature(line);
    const sameAsH1 = sig && h1Sig && (sig === h1Sig || h1Sig.includes(sig) || sig.includes(h1Sig));
    const sameAsTitle = sig && titleSig && (sig === titleSig || titleSig.includes(sig) || sig.includes(titleSig));
    if (!sameAsH1 && !sameAsTitle) continue;
    lines.splice(index, 1);
    changed = true;
    break;
  }

  const next = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { markdown: next, changed: changed && next !== markdown.trim() };
}

const LOW_VALUE_SUBHEADING_RE =
  /^(?:\uC0C1\uD669\uBCC4\s*\uC120\uD0DD\s*\uAE30\uC900|\uCD9C\uBC1C\s*\uC804\s*\uCD5C\uC885\s*\uCCB4\uD06C|\uACE0\uAC1D\uC774\s*\uB9CE\uC774\s*\uD5F7\uAC08\uB9AC\uB294\s*\uBD80\uBD84|\uC5EC\uD589\s*\uC0C1\uD488\uACFC\s*\uD568\uAED8\s*\uD655\uC778\uD558\uAE30|\uC0C1\uD488\uACFC\s*\uD568\uAED8\s*\uD655\uC778\uD558\uAE30|\uC790\uC8FC\s*\uBB3B\uB294\s*\uC9C8\uBB38|FAQ|Q\s*&\s*A|recommended\s+posts?|related\s+posts?|related\s+packages?|Q\d+[.)]?\s*.+)$/i;

function flattenLowValueSubheadings(markdown: string): { markdown: string; changed: boolean } {
  let changed = false;
  const next = markdown
    .split('\n')
    .map((line) => {
      const match = line.match(/^#{2,3}\s+(.+?)\s*$/);
      if (!match) return line;
      const heading = match[1]?.trim() ?? '';
      if (!LOW_VALUE_SUBHEADING_RE.test(heading)) return line;
      changed = true;
      return `**${heading}**`;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { markdown: next, changed: changed && next !== markdown.trim() };
}

function removeStandaloneHorizontalRules(markdown: string): { markdown: string; changed: boolean } {
  const next = markdown
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { markdown: next, changed: next !== markdown.trim() };
}

const LOW_VALUE_OVERFLOW_HEADING_RE =
  /(?:\uC77D\uB294\s*\uC21C\uC11C|\uC790\uC8FC\s*\uBB3B\uB294\s*\uC9C8\uBB38|\uAD00\uB828\s*\uD328\uD0A4\uC9C0|\uCD94\uCC9C\s*\uD3EC\uC2A4\uD305|\uC5EC\uC18C\uB0A8\s*\uC5EC\uD589\s*\uC900\uBE44|\uC0C1\uB2F4|CTA|FAQ|Q\s*&\s*A|recommended\s+posts?|related\s+packages?)/i;

function pruneLowValueOverflowSections(markdown: string): { markdown: string; changed: boolean } {
  const h2Lines = markdown.match(/^##\s+\S.*$/gm) ?? [];
  if (h2Lines.length < 10) return { markdown, changed: false };

  const lines = markdown.split('\n');
  const kept: string[] = [];
  let h2Seen = 0;
  let changed = false;

  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? '';
    const isH2 = /^##\s+\S/.test(line);
    if (!isH2) {
      kept.push(line);
      index += 1;
      continue;
    }

    h2Seen += 1;
    const shouldPrune = h2Seen > 8 && LOW_VALUE_OVERFLOW_HEADING_RE.test(stripMarkup(line));
    if (!shouldPrune) {
      kept.push(line);
      index += 1;
      continue;
    }

    changed = true;
    index += 1;
    while (index < lines.length && !/^##\s+\S/.test(lines[index] ?? '')) {
      index += 1;
    }
  }

  const next = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { markdown: next, changed: changed && next !== markdown.trim() };
}

const PRESERVE_H2_HEADING_RE =
  /(?:공식\s*확인\s*링크|official\s+source|출처|근거|주의\s*사항|가격\s*변동|포함\/불포함|10초\s*판단|자주\s*묻는\s*질문|체크\s*리스트|체크리스트|준비물|checklist|packing)/i;

function flattenExcessH2Headings(markdown: string, maxH2 = 8): { markdown: string; changed: boolean } {
  let h2Seen = 0;
  let changed = false;
  const next = markdown
    .split('\n')
    .map((line) => {
      const match = line.match(/^##\s+(.+?)\s*$/);
      if (!match) return line;
      const heading = match[1]?.trim() ?? '';
      h2Seen += 1;
      if (h2Seen <= maxH2 || PRESERVE_H2_HEADING_RE.test(heading)) return line;
      changed = true;
      return `**${heading}**`;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { markdown: next, changed: changed && next !== markdown.trim() };
}

function separateMarkdownTables(markdown: string): { markdown: string; changed: boolean } {
  const lines = markdown.split('\n');
  const next: string[] = [];
  let changed = false;
  const isTableRow = (line: string | undefined) => Boolean(line && /^\s*\|.*\|\s*$/.test(line));

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const previous = next[next.length - 1];
    if (isTableRow(line) && previous && previous.trim() && !isTableRow(previous)) {
      next.push('');
      changed = true;
    }

    next.push(line);

    const following = lines[index + 1];
    if (isTableRow(line) && following && following.trim() && !isTableRow(following)) {
      next.push('');
      changed = true;
    }
  }

  const output = next.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { markdown: output, changed: changed && output !== markdown.trim() };
}

function removeEmptyCtaResidue(markdown: string): { markdown: string; changed: boolean } {
  const next = markdown
    .replace(EMPTY_CTA_SENTENCE_RE, (match) => (match.startsWith('\n') ? '\n' : ''))
    .replace(/^\s*(?:\uC9C0\uAE08\s*\uBC14\uB85C|\uBC14\uB85C)\s*\uB97C\s*\uD074\uB9AD[^\n]*$/gmi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { markdown: next, changed: next !== markdown.trim() };
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
    : buildAnswerFirstLead(input, destination);

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

function readableTopicContext(input: BlogFinalCustomerSurfaceInput): string {
  return [input.title, input.primaryKeyword, input.slug]
    .filter(Boolean)
    .join(' ');
}

function buildReadableAnswerFirstLead(input: BlogFinalCustomerSurfaceInput, destination: string | null): string | null {
  const context = readableTopicContext(input);
  const topic = destination || cleanLabel(input.primaryKeyword) || cleanLabel(input.title) || '이 여행';
  if (/비자|입국|서류|여권|무비자|체류/.test(context)) {
    return `${topic} 준비는 가격보다 입국 조건, 여권 유효기간, 필요 서류를 먼저 확인해야 합니다. 무비자 가능 여부와 체류 가능 일수는 바뀔 수 있으니 출발 전 공식 안내로 다시 확인하세요.`;
  }
  if (/보험|보장|병원|수하물|항공\s*지연/.test(context)) {
    return `${topic} 보험은 가입 여부보다 항공 지연, 병원 이용, 수하물 분실, 기존 카드 보장 범위를 나눠 보는 것이 먼저입니다. 여행 기간과 동행자 나이에 맞춰 부족한 보장만 추가하세요.`;
  }
  if (/공항|시내|교통|이동|픽업|택시|버스/.test(context)) {
    return `${topic} 이동은 요금만 보지 말고 도착 시간, 짐 개수, 숙소 위치, 결제 수단을 함께 봐야 합니다. 첫날은 가장 빠른 방법보다 실수 가능성이 낮은 동선을 고르는 편이 안전합니다.`;
  }
  return null;
}

function readableLeadMismatchesTopic(plain: string, input: BlogFinalCustomerSurfaceInput): boolean {
  const context = readableTopicContext(input);
  if (/비자|입국|서류|여권|무비자|체류/.test(context)) {
    return !/비자|입국|서류|여권|무비자|체류|공식/.test(plain)
      || /가격표|현지\s*추가비|총액|상품|패키지|식사\s*포함/.test(plain);
  }
  if (/보험|보장|병원|수하물|항공\s*지연/.test(context)) {
    return !/보험|보장|병원|의료|수하물|항공\s*지연|카드/.test(plain);
  }
  if (/공항|시내|교통|이동|픽업|택시|버스/.test(context)) {
    return !/공항|시내|이동|픽업|택시|버스|숙소|도착/.test(plain);
  }
  return false;
}

function repairCommonSurfaceParticles(markdown: string): { markdown: string; changed: boolean } {
  const before = markdown;
  const particleFor = (word: string, withBatchim: string, withoutBatchim: string): string | null => {
    const chars = Array.from(word.trim()).reverse();
    const lastHangul = chars.find((char) => {
      const code = char.charCodeAt(0);
      return code >= 0xac00 && code <= 0xd7a3;
    });
    if (!lastHangul) return null;
    const hasBatchim = ((lastHangul.charCodeAt(0) - 0xac00) % 28) > 0;
    return hasBatchim ? withBatchim : withoutBatchim;
  };
  const correctSubjectOrObjectParticle = (word: string, particle: string): string => {
    const normalizedParticle = particleFor(word, '은', '는');
    if (normalizedParticle !== '는') return particle;
    return particle === '은' ? '는' : '를';
  };
  const next = markdown
    .replace(/([가-힣]{2,16})(?:과|와)(?:은|을)(?=\s|$|[.,!?])/g, (match, word: string) => {
      const particle = particleFor(word, '은', '는');
      return particle ? `${word}${particle}` : match;
    })
    .replace(/(\*\*|__|==|`)([가-힣]{2,12})(은|을)\1(?=\s|$|[.,!?])/g,
      (match, marker: string, word: string, particle: string) => {
        const corrected = correctSubjectOrObjectParticle(word, particle);
        return corrected === particle ? match : `${marker}${word}${corrected}${marker}`;
      })
    .replace(/(\*\*|__|==|`)([가-힣]{2,12})\1(은|을)(?=\s|$|[.,!?])/g,
      (match, marker: string, word: string, particle: string) => {
        const corrected = correctSubjectOrObjectParticle(word, particle);
        return corrected === particle ? match : `${marker}${word}${marker}${corrected}`;
      })
    .replace(/([가-힣]{2,12})(\*\*|__|==|`)(은|을)\2(?=\s|$|[.,!?])/g,
      (match, word: string, marker: string, particle: string) => {
        const corrected = correctSubjectOrObjectParticle(word, particle);
        return corrected === particle ? match : `${word}${marker}${corrected}${marker}`;
      })
    .replace(/\[([^\]\n]*?)([가-힣]{2,12})\]\(([^)\n]+)\)(은|을)(?=\s|$|[.,!?])/g,
      (match, prefix: string, word: string, url: string, particle: string) => {
        const corrected = correctSubjectOrObjectParticle(word, particle);
        return corrected === particle ? match : `[${prefix}${word}](${url})${corrected}`;
      })
    .replace(/\[([^\]\n]*?)([가-힣]{2,12})\]\(([^)\n]+)\)(\*\*|__|==|`)(은|을)\4(?=\s|$|[.,!?])/g,
      (match, prefix: string, word: string, url: string, marker: string, particle: string) => {
        const corrected = correctSubjectOrObjectParticle(word, particle);
        return corrected === particle
          ? match
          : `[${prefix}${word}](${url})${marker}${corrected}${marker}`;
      })
    .replace(/체크리스트을/g, '체크리스트를')
    .replace(/([가-힣]{2,12})(은|을)(?=\s|$|[.,!?])/g, (match, word: string, particle: string) => {
    const normalizedParticle = particleFor(word, '은', '는');
    if (!normalizedParticle) return match;
    const hasBatchim = normalizedParticle === '은';
    if (hasBatchim) return match;
    return `${word}${particle === '은' ? '는' : '를'}`;
  })
    .replace(/입국신고(?!서)/g, '입국 신고');
  return { markdown: next, changed: next !== before };
}

function repairOrphanPipeDelimitedRows(markdown: string): { markdown: string; changed: boolean } {
  let changed = false;
  const next = markdown.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('|') || trimmed.startsWith('```')) return line;
    const segments = trimmed.split(/\s+\|\s+/).map((segment) => segment.trim()).filter(Boolean);
    if (segments.length < 3 || trimmed.length < 100) return line;
    changed = true;
    return segments.map((segment) => `- ${segment}`).join('\n');
  }).join('\n');
  return { markdown: next, changed };
}

export function repairBlogFinalInlineSurface(markdown: string): BlogFinalCustomerSurfaceResult {
  const particleRepair = repairCommonSurfaceParticles(markdown || '');
  const orphanPipeRepair = repairOrphanPipeDelimitedRows(particleRepair.markdown);
  const changes = [
    ...(particleRepair.changed ? ['repair_common_surface_particles'] : []),
    ...(orphanPipeRepair.changed ? ['repair_orphan_pipe_delimited_rows'] : []),
  ];
  return {
    markdown: orphanPipeRepair.markdown,
    changed: changes.length > 0,
    changes,
  };
}

function deterministicVariantIndex(seed: string, size: number): number {
  if (size <= 1) return 0;
  let hash = 0;
  for (const char of seed) {
    hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  }
  return hash % size;
}

function pickVariant(seed: string, variants: string[]): string {
  return variants[deterministicVariantIndex(seed, variants.length)] ?? variants[0] ?? '';
}

function buildAnswerFirstLead(input: BlogFinalCustomerSurfaceInput, destination: string | null): string {
  const readableLead = buildReadableAnswerFirstLead(input, destination);
  if (readableLead) return readableLead;

  const topic = input.primaryKeyword || input.title || destination || '여행 준비';
  const topicParticle = hasKoreanBatchim(topic) ? '은' : '는';
  const context = `${input.title || ''} ${input.primaryKeyword || ''} ${input.slug || ''}`;
  const seed = `${input.slug || ''}|${input.title || ''}|${input.primaryKeyword || ''}|${destination || ''}`;
  const destinationLabel = destination || topic;
  if (/(?:budget|cost|food|shopping|expense|money)|예산|비용|경비|식비|쇼핑/.test(context)) {
    return pickVariant(seed, [
      `${destinationLabel} 예산은 상품가 1개만 보면 부족합니다. 항공·숙소 결제액과 현지 식비, 교통비, 선택 관광, 팁을 나눠 비교하면 실제 총액이 먼저 보입니다.`,
      `${destinationLabel} 비용은 1인 금액과 가족·동행자 전체 총액을 따로 비교해야 합니다. 현지 식비, 이동비, 선택 비용까지 분리하면 과소예산을 줄일 수 있습니다.`,
      `${destinationLabel} 여행비가 비슷해 보여도 포함 항목과 현지 추가비 3가지에 따라 체감 총액이 달라집니다. 예약 전에는 결제액, 현장 지출, 변동 가능 비용을 비교하세요.`,
      `${destinationLabel}에서 돈이 새는 지점은 보통 식사, 이동, 선택 관광, 팁 4가지입니다. 상품가와 현지 지출을 한 표로 비교하면 내 일정에 맞는 예산인지 빠르게 판단할 수 있습니다.`,
      `${destinationLabel} 경비는 항공권처럼 이미 낸 돈과 현지에서 다시 쓰는 돈 2가지를 나눠 봐야 합니다. 식비, 이동비, 선택 관광, 카드 수수료를 따로 적으면 실제 부담이 더 선명해집니다.`,
      `${destinationLabel} 예산을 잡을 때는 최저가보다 빠질 수 있는 항목 3가지를 먼저 확인하는 편이 안전합니다. 1인 금액, 가족 총액, 현지 추가비를 나누면 예약 후 당황할 가능성이 줄어듭니다.`,
      `${destinationLabel} 비용 비교는 표시 가격보다 포함/불포함 2가지를 먼저 보는 쪽이 정확합니다. 공항 이동, 식사, 선택 관광, 팁까지 더하면 같은 가격도 체감 총액이 달라질 수 있습니다.`,
      `${destinationLabel} 여행 경비는 출발 전 결제액과 현지 지출액을 따로 계산해야 합니다. 특히 가족 일정은 1인 기준보다 전체 인원 총액으로 보는 편이 실수 없습니다.`,
    ]);
  }
  if (/(?:weather|packing|clothes|clothing|rain|july|june)|날씨|옷차림|준비물|체크리스트|우기|건기|비\s*예보|기온/.test(context)) {
    return pickVariant(seed, [
      `${destinationLabel} 날씨는 낮 최고기온보다 일교차, 비 예보, 이동 동선을 함께 봐야 합니다. 출발 7일 전에는 겉옷·방수용품·자외선 차단 품목을 다시 확인하는 편이 좋습니다.`,
      `${destinationLabel} 옷차림은 한 벌을 두껍게 준비하기보다 얇은 옷과 겉옷을 나누는 방식이 안전합니다. 출발 7일 전 비 예보가 있으면 접는 우산, 우비, 잘 마르는 신발 3가지를 같이 보세요.`,
      `${destinationLabel} 준비물은 기온표만 보고 고르면 빠지는 게 생깁니다. 출발 24시간 전 아침·저녁 기온, 소나기 가능성, 차량 이동 시간을 기준으로 옷·상비약·전자기기를 나눠 챙기세요.`,
      `${destinationLabel} 여행 전에는 오늘 날씨보다 출발일 전후 예보가 더 중요합니다. 출발 7일 전과 24시간 전 비 예보, 체감온도, 실내외 이동 비중을 확인하면 현지 불편을 줄일 수 있습니다.`,
      `${destinationLabel} 날씨 글은 평균 기온만 보면 준비가 부족합니다. 낮 이동, 밤 일정, 비 오는 시간대를 나눠 보고 겉옷·우산·방수 파우치부터 먼저 챙기세요.`,
      `${destinationLabel} 옷차림은 낮 기온보다 하루 중 가장 불편할 순간을 기준으로 잡는 편이 좋습니다. 출발 7일 전에는 비 예보, 냉방 강도, 장거리 이동 시간을 함께 확인하세요.`,
      `${destinationLabel} 준비물은 더위나 추위 하나만 보고 정하면 빠뜨리기 쉽습니다. 출발 7일 전 예보와 24시간 전 항공·현지 안내를 다시 보고 옷, 약, 충전기, 방수용품을 나누세요.`,
      `${destinationLabel} 날씨는 여행 만족도보다 일정 운영에 더 직접적으로 영향을 줍니다. 비가 오면 바꿀 실내 일정, 젖어도 되는 신발, 여벌 옷을 먼저 정해 두는 편이 안전합니다.`,
    ]);
  }
  if (/보험|보장|병원|수하물|상해|질병|분실/.test(context)) {
    return `${topic}${topicParticle} 출발 전 항공 지연, 병원 이용, 수하물 분실, 현지 결제 가능 범위를 먼저 나눠 보면 필요 여부를 판단하기 쉽습니다. 여행 기간과 동행자 나이, 기존 카드 보험을 확인한 뒤 부족한 보장만 추가하세요.`;
  }
  if (/로밍|유심|이심|eSIM|데이터|통신|전화/.test(context)) {
    return `${topic}${topicParticle} 가격만 보지 말고 개통 방식, 데이터 용량, 통화 필요 여부, 현지 앱 인증 가능성을 함께 확인해야 합니다. 짧은 일정은 로밍, 장기·가족 일정은 유심이나 eSIM 비교가 유리한 경우가 많습니다.`;
  }
  if (/비자|입국|서류|여권|세관|면세/.test(context)) {
    return `${topic}${topicParticle} 출발 2주 전 무비자 가능 여부, 체류 가능 일수, 여권 6개월 기준, 항공사 요구 서류를 공식 안내로 다시 확인해야 합니다. 여권·항공권·숙소 정보·입국 신고 조건을 나누면 공항에서 빠뜨릴 항목을 줄일 수 있습니다.`;
  }
  if (/공항|픽업|택시|렌터카|교통|이동|동선|시내/.test(context)) {
    return `${topic}${topicParticle} 도착 시간, 숙소 위치, 결제 수단, 이동 앱 사용 가능 여부를 함께 봐야 첫날 1~2시간 손실을 줄일 수 있습니다. 짐이 많거나 밤 도착이면 택시·픽업, 낮 도착이면 앱 호출과 셔틀을 비교하세요.`;
  }
  if (/아이|가족|일정|코스/.test(context)) {
    return `${destination || topic} 가족여행은 하루 코스를 많이 넣기보다 이동 1회당 시간, 숙소 위치, 식사·휴식 시간을 먼저 맞추는 편이 좋습니다. 첫날은 이동과 휴식, 둘째 날 이후는 투어·리조트·시내 일정을 나눠 잡으세요.`;
  }
  if (/예산|비용|식비|경비|쇼핑/.test(context)) {
    return `${topic}${topicParticle} 항공·숙소 결제액과 현지 식비, 교통비, 선택 관광, 팁을 따로 봐야 실제 총액이 잡힙니다. 먼저 1인 비용과 가족 총액, 현지 추가비 가능 항목을 나누면 과소예산을 줄일 수 있습니다.`;
  }
  if (/날씨|옷차림|준비물|체크리스트|우기|건기/.test(context)) {
    return `${topic}${topicParticle} 낮 기온만 보지 말고 출발 7일 전과 24시간 전 비 예보, 아침·저녁 기온 차이, 이동 동선을 함께 봐야 합니다. 옷차림은 얇은 옷과 겉옷을 나눠 준비하는 편이 안전합니다.`;
  }
  return `${topic}${topicParticle} 일정, 비용, 이동 시간, 현지 확인 조건을 먼저 나누면 판단이 쉽습니다. 출발일 기준으로 바뀔 수 있는 항목을 다시 확인하고, 표와 체크리스트에서 필요한 부분만 빠르게 비교하세요.`;
}

function ensureAnswerFirstLead(markdown: string, input: BlogFinalCustomerSurfaceInput): { markdown: string; changed: boolean } {
  const lines = markdown.split('\n');
  const h1Index = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  if (h1Index < 0) return { markdown, changed: false };

  let leadStart = h1Index + 1;
  while (leadStart < lines.length && lines[leadStart]?.trim() === '') leadStart += 1;
  if (leadStart >= lines.length) return { markdown, changed: false };

  if (/^#{2,6}\s+\S/.test(lines[leadStart]?.trim() ?? '') || /^!\[/.test(lines[leadStart]?.trim() ?? '') || /^\|.*\|$/.test(lines[leadStart]?.trim() ?? '')) {
    const destination = inferDestination(input);
    const lead = buildAnswerFirstLead(input, destination);
    const next = [
      ...lines.slice(0, h1Index + 1),
      '',
      lead,
      '',
      ...lines.slice(leadStart),
    ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { markdown: next, changed: next !== markdown };
  }

  let paragraphEnd = leadStart + 1;
  while (paragraphEnd < lines.length) {
    const trimmed = lines[paragraphEnd]?.trim() ?? '';
    if (!trimmed || /^#{2,6}\s+\S/.test(trimmed) || /^!\[/.test(trimmed) || /^\|.*\|$/.test(trimmed)) break;
    paragraphEnd += 1;
  }

  const firstSectionEnd = lines.findIndex((line, index) => {
    if (index <= h1Index) return false;
    const trimmed = line.trim();
    return /^#{2,6}\s+\S/.test(trimmed) || /^!\[/.test(trimmed) || /^\|.*\|$/.test(trimmed);
  });
  const existingLead = lines
    .slice(leadStart, paragraphEnd)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^[-*]\s+/.test(line) && !/\[[^\]\n]+]\([^)]+\)/.test(line))
    .join(' ');
  const plain = stripMarkup(existingLead);
  const weakLead =
    plain.length < 70
    || readableLeadMismatchesTopic(plain, input)
    || /^택시|^그랩|^셔틀|^확인|^비교|^준비/.test(plain)
    || /핵심\s*요약|기준으로\s*(?:보면|확인하면)\s*됩니다/.test(plain)
    || /(?:날씨|비용|예산|준비물|체크리스트)(?:은|는)\s*먼저/.test(plain)
    || /먼저\s*총액에서\s*무엇이\s*빠지는지\s*봐야\s*할까요/.test(plain)
    || /(?:날씨[,\s]*)?출발\s*\d+\s*일\s*전\s*무엇을\s*다시\s*봐야\s*할까요/.test(plain);
  if (!weakLead && /먼저|확인|비교|준비|비용|가격|시간|날씨|입국|여권|보험|로밍|유심|공항|이동|\d/.test(plain)) {
    return { markdown, changed: false };
  }

  const destination = inferDestination(input);
  const lead = buildAnswerFirstLead(input, destination);
  const replaceEnd = paragraphEnd > leadStart ? paragraphEnd : (firstSectionEnd >= 0 ? firstSectionEnd : leadStart);
  const next = [
    ...lines.slice(0, leadStart),
    lead,
    '',
    ...lines.slice(replaceEnd),
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
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
  apply('remove_empty_cta_residue', removeEmptyCtaResidue(markdown));
  apply('remove_chatty_info_intro', removeChattyInfoIntro(markdown));
  apply('remove_generated_instruction_residue', removeGeneratedInstructionResidue(markdown));
  apply('dedupe_repeated_plain_paragraphs', dedupeRepeatedPlainParagraphs(markdown));
  apply('dedupe_repeated_plain_sentences', dedupeRepeatedPlainSentences(markdown));
  apply('remove_duplicate_heading_sections', removeDuplicateHeadingSections(markdown));
  apply('remove_redundant_title_heading', removeRedundantTitleHeading(markdown, input));
  apply('flatten_low_value_subheadings', flattenLowValueSubheadings(markdown));
  apply('remove_standalone_horizontal_rules', removeStandaloneHorizontalRules(markdown));
  apply('prune_low_value_overflow_sections', pruneLowValueOverflowSections(markdown));
  apply('flatten_excess_h2_headings', flattenExcessH2Headings(markdown));
  apply('separate_markdown_tables', separateMarkdownTables(markdown));
  apply('repair_monthly_weather_clothing_table', repairMonthlyWeatherClothingTable(markdown));
  apply('repair_destination_surface', repairDestinationSurface(markdown, destination));
  apply('split_paragraph_walls', splitParagraphWalls(markdown));
  apply('dedupe_lead_sentences', dedupeLeadSentences(markdown));
  apply('prune_lead_prose', pruneLeadProse(markdown, input));
  apply('ensure_answer_first_lead', ensureAnswerFirstLead(markdown, input));
  apply('repair_common_surface_particles', repairCommonSurfaceParticles(markdown));
  apply('repair_destination_surface_final', repairDestinationSurface(markdown, destination));

  markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();
  return {
    markdown,
    changed: markdown !== input.markdown,
    changes,
  };
}
