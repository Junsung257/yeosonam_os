import { createHash } from 'node:crypto';

export type BlogKeywordTier = 'head' | 'mid' | 'longtail';

export interface InformationalWriterPromptManifest {
  contract: 'blog_information_writer_v2';
  digest: string;
  characters: number;
  estimated_tokens: number;
  sections: string[];
  warnings: string[];
}

export interface InformationalWriterPromptAudit {
  passed: boolean;
  blockers: string[];
  warnings: string[];
}

const REQUIRED_MARKERS = [
  '## Instruction priority',
  '## Factual safety',
  '## Output contract',
  '## Assignment',
  '## Content Brief - must follow before writing',
  '## Writer: info_writer',
  '## Current quality contract',
  '## Structured factual claim ledger',
] as const;

const LEGACY_CONFLICTS: Array<{ id: string; pattern: RegExp }> = [
  { id: 'fixed_character_target', pattern: /(?:총|본문)\s*(?:1,200|1,800|2,200)[~～-](?:1,800|2,500|3,000)자/i },
  { id: 'keyword_repetition_quota', pattern: /(?:5[~～-]8회\s*반복|반복률\s*1\.[25]%|keyword\s+density\s+(?:target|quota))/i },
  { id: 'required_product_link', pattern: /내부\s*링크\s*\(여소남\s*상품\s*페이지\)\s*1개\s*이상/i },
  { id: 'required_hashtag_block', pattern: /(?:해시태그|hashtags?).{0,20}(?:15개|15\s*개|required)/i },
  { id: 'required_sales_cta', pattern: /(?:CTA|상담|예약).{0,24}(?:3-tier|3단계|필수\s*포함)/i },
];

export function auditInformationalWriterPrompt(prompt: string): InformationalWriterPromptAudit {
  const blockers = [
    ...REQUIRED_MARKERS
      .filter((marker) => !prompt.includes(marker))
      .map((marker) => `missing_marker:${marker}`),
    ...LEGACY_CONFLICTS
      .filter(({ pattern }) => pattern.test(prompt))
      .map(({ id }) => `legacy_conflict:${id}`),
  ];
  const warnings: string[] = [];
  if (prompt.length > 30_000) warnings.push('prompt_over_30000_characters');
  if (!/official|primary.source|공식/i.test(prompt)) warnings.push('official_source_guidance_missing');
  return { passed: blockers.length === 0, blockers, warnings };
}

export function buildInformationalDepthBlock(tier: BlogKeywordTier): string {
  const guidance: Record<BlogKeywordTier, string[]> = {
    head: [
      'Cover the main decision and the important adjacent questions a first-time traveler is likely to have.',
      'Use a clear overview, scenario differences, risks, and official checks. Add an FAQ only when the brief supplies useful questions.',
    ],
    mid: [
      'Resolve the named comparison or planning task with enough context to make a choice.',
      'Prefer practical criteria, a supported comparison, common mistakes, and the next official check.',
    ],
    longtail: [
      'Answer the narrow scenario directly and stay tightly within it.',
      'Do not broaden the article merely to make it longer. Include only details that change the reader decision.',
    ],
  };
  return ['## Reader-task depth', ...guidance[tier].map((line) => `- ${line}`)].join('\n');
}

export function buildInformationalQualityBlock(input: {
  primaryKeyword: string;
  destination?: string | null;
}): string {
  return [
    '## Current quality contract',
    '- Internal micro-angle ids and English planning labels must never appear in the H1, headings, or body.',
    `- The opening must directly answer the reader task for: ${input.primaryKeyword}.`,
    '- A table must have a header, separator, and at least three real body rows. Use a checklist when fewer supported rows exist.',
    '- Do not use ==highlight==, <mark>, fake emphasis syntax, or unexplained placeholders.',
    '- Link to official or primary sources for policy, entry, weather, airport, transport, insurance, customs, ticket, or other changeable conditions.',
    input.destination
      ? `- Keep the article specific to ${input.destination}; do not drift into a generic travel guide.`
      : '- Stay destination-neutral only when the content brief explicitly permits a generic guide.',
    '- Use the primary keyword only where it reads naturally. Never repeat it to satisfy a count.',
    '- Do not add a sales or action block; the public renderer owns that surface.',
  ].join('\n');
}

export function buildInformationalWriterPrompt(input: {
  guide: string;
  assignmentBlock: string;
  contextBlocks: Array<string | null | undefined>;
  depthBlock: string;
  qualityBlock: string;
}): { prompt: string; manifest: InformationalWriterPromptManifest } {
  const sections = [
    'guide',
    'assignment',
    'context',
    'depth',
    'quality',
  ];
  const prompt = [
    input.guide.trim(),
    input.assignmentBlock.trim(),
    ...input.contextBlocks.map((block) => block?.trim()).filter((block): block is string => Boolean(block)),
    input.depthBlock.trim(),
    input.qualityBlock.trim(),
  ].join('\n\n---\n\n');
  const audit = auditInformationalWriterPrompt(prompt);
  if (!audit.passed) {
    throw new Error(`blog_info_prompt_contract_failed:${audit.blockers.join(',')}`);
  }
  return {
    prompt,
    manifest: {
      contract: 'blog_information_writer_v2',
      digest: createHash('sha256').update(prompt).digest('hex'),
      characters: prompt.length,
      estimated_tokens: Math.ceil(prompt.length / 4),
      sections,
      warnings: audit.warnings,
    },
  };
}
