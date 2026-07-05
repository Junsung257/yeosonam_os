const PROMPT_RESIDUE_PATTERNS = [
  /\bprompt\b/i,
  /프롬프트\s*(?:지시|규칙|출력|작성)/i,
  /(?:내부|작성|출력)\s*(?:지시|규칙|가이드라인)/i,
  /규칙\s*[A-Z가-힣0-9]{1,3}\s*(?:\([^)\n]{0,50}\))?\s*[:：]/i,
  /(?:감각\s*디테일|2인칭\s*시나리오|구체\s*수치)\s*[:：]?/i,
];

const PROMPT_RESIDUE_PREFIX_RE =
  /^(\s*(?:[-*]\s*)?(?:#{1,6}\s*)?)(?:\*\*)?(?:규칙\s*[A-Z가-힣0-9]{1,3}\s*(?:\([^)\n]{0,50}\))?|감각\s*디테일|2인칭\s*시나리오|구체\s*수치)\s*(?:\*\*)?\s*[:：]\s*(?:\*\*)?\s*/i;

const STANDALONE_PROMPT_RESIDUE_RE =
  /^\s*(?:[-*]\s*)?(?:#{1,6}\s*)?(?:\*\*)?(?:규칙\s*[A-Z가-힣0-9]{1,3}\s*(?:\([^)\n]{0,50}\))?|감각\s*디테일|2인칭\s*시나리오|구체\s*수치|프롬프트\s*(?:지시|규칙|출력|작성)|(?:내부|작성|출력)\s*(?:지시|규칙|가이드라인))(?:\*\*)?\s*[:：]?\s*$/i;

const INLINE_PROMPT_RESIDUE_RE =
  /\s*(?:(?:\*\*)?(?:규칙\s*[A-Z가-힣0-9]{1,3}\s*(?:\([^)\n]{0,50}\))?|감각\s*디테일|2인칭\s*시나리오|구체\s*수치)(?:\*\*)?\s*[:：]\s*|2인칭\s*시나리오를\s*드리자면\s*,?)\s*/gi;

export function findBlogPromptInstructionResidue(text: string): string[] {
  const samples: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const compact = line.trim();
    if (!compact) continue;
    if (PROMPT_RESIDUE_PATTERNS.some((pattern) => pattern.test(compact))) {
      samples.push(compact.slice(0, 160));
    }
    if (samples.length >= 5) break;
  }
  return samples;
}

export function hasBlogPromptInstructionResidue(text: string): boolean {
  return findBlogPromptInstructionResidue(text).length > 0;
}

export function repairBlogPromptInstructionResidue(markdown: string): {
  text: string;
  changed: boolean;
  removedCount: number;
  samples: string[];
} {
  let removedCount = 0;
  const samples: string[] = [];

  const normalized = markdown.replace(INLINE_PROMPT_RESIDUE_RE, ' ');
  if (normalized !== markdown) {
    removedCount += 1;
  }

  const lines = normalized.split(/\r?\n/);
  const next = lines.flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) return [line];

    if (STANDALONE_PROMPT_RESIDUE_RE.test(trimmed)) {
      removedCount += 1;
      samples.push(trimmed.slice(0, 160));
      return [];
    }

    if (PROMPT_RESIDUE_PREFIX_RE.test(line)) {
      const repaired = line.replace(PROMPT_RESIDUE_PREFIX_RE, '$1').trimEnd();
      removedCount += 1;
      samples.push(trimmed.slice(0, 160));
      return repaired.trim().length >= 8 ? [repaired] : [];
    }

    return [line];
  });

  const text = next.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return {
    text,
    changed: text !== markdown.trim(),
    removedCount,
    samples,
  };
}
