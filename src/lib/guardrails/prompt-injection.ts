const INJECTION_PATTERNS = [
  /ignore\s+previous\s+instructions/i,
  /ignore\s+(system|developer)\s+instructions/i,
  /ignore\s+(all\s+)?(system|developer)\s+instructions/i,
  /reveal\s+system\s+prompt/i,
  /show\s+me\s+(your\s+)?(system|developer)\s+(prompt|message)/i,
  /bypass\s+(auth|authorization|permission|rls|tenant)/i,
  /run\s+tool\s+without\s+approval/i,
  /tool.*force/i,
];

const INJECTION_TERMS = [
  '\uc774\uc804 \uc9c0\uc2dc \ubb34\uc2dc',
  '\uc9c0\uc2dc \ubb34\uc2dc',
  '\uc2dc\uc2a4\ud15c \ud504\ub86c\ud504\ud2b8',
  '\uac1c\ubc1c\uc790 \uba54\uc2dc\uc9c0',
  '\uc228\uaca8\uc9c4 \uc9c0\uc2dc',
  '\uc228\uaca8\uc9c4 \ud504\ub86c\ud504\ud2b8',
  '\uad8c\ud55c \uc6b0\ud68c',
  '\uad00\ub9ac\uc790 \uad8c\ud55c',
  '\ud14c\ub10c\ud2b8 \uc6b0\ud68c',
  'rls \ud574\uc81c',
  'rls \uc6b0\ud68c',
  'rls \ubb34\uc2dc',
  '\uc2b9\uc778 \uc5c6\uc774',
  '\uc2b9\uc778\uc5c6\uc774',
  '\ub3c4\uad6c \uac15\uc81c \uc2e4\ud589',
  '\ubb34\uc870\uac74 \ud658\ubd88',
  '1\uc6d0 \uacb0\uc81c',
];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectPromptInjection(message: string): {
  blocked: boolean;
  reason: string | null;
} {
  const normalized = normalize(message);
  const regexHit = INJECTION_PATTERNS.find((re) => re.test(message));
  if (regexHit) {
    return {
      blocked: true,
      reason: `suspicious pattern: ${regexHit.toString()}`,
    };
  }

  const termHit = INJECTION_TERMS.find((term) => normalized.includes(normalize(term)));
  if (!termHit) return { blocked: false, reason: null };
  return {
    blocked: true,
    reason: `suspicious term: ${termHit}`,
  };
}
