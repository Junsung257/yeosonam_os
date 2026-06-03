export type UploadInputIssueCode =
  | 'encoding_corrupted'
  | 'web_page_copy'
  | 'non_product_prompt'
  | 'weak_product_source';

export interface UploadInputIssue {
  code: UploadInputIssueCode;
  severity: 'block' | 'review';
  message: string;
  evidence: string[];
}

export interface UploadInputAnalysis {
  normalizedText: string;
  blocked: boolean;
  needsReview: boolean;
  issues: UploadInputIssue[];
  metrics: {
    length: number;
    hangulCount: number;
    hanjaLikeCount: number;
    replacementCount: number;
    questionRunCount: number;
    webChromeScore: number;
    productAnchorScore: number;
  };
}

const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;
const HANGUL_RE = /[\u3131-\u318E\uAC00-\uD7A3]/g;
const CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF]/g;
const REPLACEMENT_RE = /\uFFFD/g;
const QUESTION_RUN_RE = /\?{3,}/g;
const MOJIBAKE_TOKEN_RE = /(?:\u5360|\uFFFD|\u907A\u0080)/g;

function rx(source: string, flags = ''): RegExp {
  return new RegExp(source, flags);
}

const WEB_CHROME_PATTERNS: Array<[RegExp, string]> = [
  [rx('\\uD648\\s+\\uD574\\uC678\\s*\\uD328\\uD0A4\\uC9C0|\\uD14C\\uB9C8\\s*\\uC5EC\\uD589|\\uB9E4\\uAC70\\uC9C4|\\uB2E8\\uCCB4\\s*\\uBB38\\uC758'), 'site navigation'],
  [rx('\\uC0C1\\uD488\\uC815\\uBCF4\\s*\\uC694\\uAE08\\uD45C\\s*\\uC77C\\uC815\\uD45C|\\uC608\\uC57D\\s*\\uBB38\\uC758|\\uBB38\\uC758\\uD558\\uAE30|\\uB0A0\\uC9DC\\s*\\uC778\\uC6D0\\s*\\uC120\\uD0DD|\\uCE74\\uCE74\\uC624\\s*\\uC0C1\\uB2F4'), 'customer page controls'],
  [rx('\\uACE0\\uAC1D\\s*\\uD6C4\\uAE30|\\uCCAB\\s*\\uBC88\\uC9F8\\s*\\uD6C4\\uAE30|\\uD604\\uC7AC\\s*\\uAE30\\uC628|Open-Meteo|Naver\\s*DataLab', 'i'), 'customer page widgets'],
  [rx('A4\\s*\\uBCF4\\uAE30|\\uBAA8\\uBC14\\uC77C\\s*LP\\s*\\uBCF4\\uAE30|\\uBE14\\uB85C\\uADF8|\\uCE74\\uB4DC\\uB274\\uC2A4|Studio|AD'), 'admin/customer render controls'],
  [rx('\\uCD5C\\uC800\\uAC00|\\uD310\\uB9E4\\uAC00\\s*\\uBCF4\\uAE30|\\uB2E4\\uB978\\s*\\uD328\\uD0A4\\uC9C0\\s*\\uBCF4\\uAE30|\\uBCF5\\uC0AC|\\uC2B9\\uC778|\\uAC70\\uBD80'), 'admin/customer action controls'],
];

const NON_PRODUCT_PATTERNS: Array<[RegExp, string]> = [
  [/\/goal|PLEASE\s+IMPLEMENT|Implementation\s+Plan|Test\s+Plan/i, 'development prompt'],
  [/AGENTS\.md|CURRENT_STATUS|CLAUDE\.md|Codex/i, 'agent/project instructions'],
  [rx('\\uC644\\uB8CC\\uC870\\uAC74|\\uD575\\uC2EC\\s*\\uC6D0\\uCE59|\\uAD6C\\uD604\\uD574\\uC918|\\uC791\\uC5C5\\s*\\uACC4\\uD68D|\\uAC1C\\uBC1C\\s*\\uD50C\\uB79C'), 'planning document'],
];

const PRODUCT_ANCHOR_PATTERNS: Array<[RegExp, string]> = [
  [rx('\\uC0C1\\uD488\\uBA85|\\uD589\\uC0AC\\uBA85|PKG|\\uD328\\uD0A4\\uC9C0', 'i'), 'title'],
  [rx('\\d+\\s*\\uBC15\\s*\\d+\\s*\\uC77C|\\d+\\s*\\uC77C\\uCC28|DAY\\s*\\d+', 'i'), 'duration/itinerary'],
  [rx('\\uD3EC\\uD568\\s*\\uC0AC\\uD56D|\\uD3EC\\uD568\\s*\\uB0B4\\uC5ED|\\uBD88\\uD3EC\\uD568\\s*\\uC0AC\\uD56D|\\uBD88\\uD3EC\\uD568\\s*\\uB0B4\\uC5ED|\\uD3EC\\uD568|\\uBD88\\uD3EC\\uD568'), 'terms'],
  [rx('\\uCD9C\\uBC1C\\uD3B8|\\uADC0\\uAD6D\\uD3B8|\\uD56D\\uACF5|[A-Z0-9]{2}\\s*\\d{2,4}|\\uC778\\uCC9C|\\uBD80\\uC0B0|\\uAE40\\uD574|\\uAE40\\uD3EC'), 'flight'],
  [rx('\\uC131\\uC778|\\uC544\\uB3D9|\\uC18C\\uC544|\\uD310\\uB9E4\\uAC00|\\uC0C1\\uD488\\uAC00|\\uAC00\\uACA9|\\uC694\\uAE08\\s*[:\uFF1A]?\\s*[0-9,]+'), 'price'],
  [rx('\\uCD5C\\uC18C\\s*\\uCD9C\\uBC1C|\\uCD5C\\uC18C\\s*\\uC778\\uC6D0|\\uBAA8\\uAC1D|\\uCD9C\\uBC1C\\s*\\uC778\\uC6D0\\s*[0-9]+'), 'minimum pax'],
  [rx('\\uD638\\uD154|\\uB9AC\\uC870\\uD2B8|\\uC870\\uC2DD|\\uC911\\uC2DD|\\uC11D\\uC2DD|\\uC804\\uC6A9\\uCC28\\uB7C9|\\uAC00\\uC774\\uB4DC|\\uC1FC\\uD551|\\uC120\\uD0DD\\uAD00\\uAD11'), 'travel components'],
  [rx('REMARK|\\uB9AC\\uB9C8\\uD06C|\\uBE44\\uACE0|\\uC720\\uC758\\uC0AC\\uD56D|\\uC5EC\\uAD8C|\\uC2F1\\uAE00\\uCC28\\uC9C0|\\uAC00\\uC774\\uB4DC\\uD301|\\uB178\\uD301|\\uB178\\uC635\\uC158', 'i'), 'notice'],
];

function countMatches(text: string, regex: RegExp): number {
  return (text.match(regex) ?? []).length;
}

function compactEvidence(text: string, regex: RegExp): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.replace(/\s+/g, ' ').trim();
    if (!trimmed || !regex.test(trimmed)) continue;
    out.push(trimmed.slice(0, 120));
    if (out.length >= 3) break;
  }
  return out;
}

function scorePatterns(text: string, patterns: Array<[RegExp, string]>): { score: number; evidence: string[] } {
  let score = 0;
  const evidence: string[] = [];
  for (const [pattern, label] of patterns) {
    pattern.lastIndex = 0;
    if (!pattern.test(text)) continue;
    score++;
    evidence.push(label);
  }
  return { score, evidence };
}

export function normalizeUploadTextForAnalysis(rawText: string): string {
  return rawText
    .replace(ZERO_WIDTH_RE, '')
    .replace(/\r\n?/g, '\n')
    .normalize('NFKC')
    .replace(/\n{4,}/g, '\n\n\n');
}

export function analyzeUploadInputText(rawText: string): UploadInputAnalysis {
  const normalizedText = normalizeUploadTextForAnalysis(rawText);
  const hangulCount = countMatches(normalizedText, HANGUL_RE);
  const hanjaLikeCount = countMatches(normalizedText, CJK_RE);
  const replacementCount = countMatches(normalizedText, REPLACEMENT_RE);
  const questionRunCount = countMatches(normalizedText, QUESTION_RUN_RE);
  const mojibakeTokenCount = countMatches(normalizedText, MOJIBAKE_TOKEN_RE);
  const web = scorePatterns(normalizedText, WEB_CHROME_PATTERNS);
  const nonProduct = scorePatterns(normalizedText, NON_PRODUCT_PATTERNS);
  const anchors = scorePatterns(normalizedText, PRODUCT_ANCHOR_PATTERNS);

  const issues: UploadInputIssue[] = [];
  const len = normalizedText.length;
  const cjkRatio = hanjaLikeCount / Math.max(1, hangulCount + hanjaLikeCount);
  const brokenRatio = (replacementCount * 4 + questionRunCount * 2 + mojibakeTokenCount) / Math.max(1, len);

  if (
    replacementCount >= 2
    || questionRunCount >= 10
    || mojibakeTokenCount >= 8
    || (mojibakeTokenCount >= 3 && hangulCount < 80)
    || (hanjaLikeCount >= 80 && hangulCount < 80 && cjkRatio >= 0.45)
    || (hanjaLikeCount >= 200 && cjkRatio >= 0.55)
    || brokenRatio >= 0.015
  ) {
    issues.push({
      code: 'encoding_corrupted',
      severity: 'block',
      message: 'Input text appears to be mojibake or incorrectly decoded. Please paste the original UTF-8 supplier text again.',
      evidence: compactEvidence(normalizedText, /[\u4E00-\u9FFF]|\?{3,}|\uFFFD|\u5360|\uFFFD/),
    });
  }

  if (web.score >= 2 && (web.score >= 3 || anchors.score <= 4)) {
    issues.push({
      code: 'web_page_copy',
      severity: 'block',
      message: 'This looks like a rendered customer/admin page copy, not supplier source text.',
      evidence: web.evidence,
    });
  }

  if (nonProduct.score >= 1 && anchors.score <= 3) {
    issues.push({
      code: 'non_product_prompt',
      severity: 'block',
      message: 'This looks like a development prompt or work instruction, not supplier product source.',
      evidence: nonProduct.evidence,
    });
  }

  if (len >= 500 && anchors.score <= 1 && web.score === 0 && nonProduct.score === 0) {
    issues.push({
      code: 'weak_product_source',
      severity: 'review',
      message: 'Core product anchors such as title, price, itinerary, inclusions, or exclusions are weak. Review is required.',
      evidence: anchors.evidence,
    });
  }

  const blocked = issues.some(issue => issue.severity === 'block');
  const needsReview = blocked || issues.some(issue => issue.severity === 'review');

  return {
    normalizedText,
    blocked,
    needsReview,
    issues,
    metrics: {
      length: len,
      hangulCount,
      hanjaLikeCount,
      replacementCount,
      questionRunCount,
      webChromeScore: web.score,
      productAnchorScore: anchors.score,
    },
  };
}