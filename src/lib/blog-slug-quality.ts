export type BlogSlugQualityIssueCode =
  | 'missing_slug'
  | 'hash_suffix_slug'
  | 'generic_travel_guide_slug'
  | 'numeric_leading_slug'
  | 'draft_or_test_slug'
  | 'invalid_slug_chars'
  | 'keyword_mismatch_slug';

export interface BlogSlugQualityIssue {
  code: BlogSlugQualityIssueCode;
  severity: 'critical' | 'warning';
  message: string;
}

export interface BlogSlugQualityReport {
  passed: boolean;
  score: number;
  issues: BlogSlugQualityIssue[];
}

function addIssue(
  issues: BlogSlugQualityIssue[],
  code: BlogSlugQualityIssueCode,
  severity: 'critical' | 'warning',
  message: string,
): void {
  issues.push({ code, severity, message });
}

function slugTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[-_\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function keywordTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .split(/[-_\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && /[a-z0-9]/i.test(token) && !/^(?:travel|guide|202\d)$/.test(token));
}

export function inspectBlogSlugQuality(input: {
  slug?: string | null;
  primaryKeyword?: string | null;
  destination?: string | null;
}): BlogSlugQualityReport {
  const issues: BlogSlugQualityIssue[] = [];
  const slug = input.slug?.trim().toLowerCase() ?? '';

  if (!slug) {
    addIssue(issues, 'missing_slug', 'critical', 'Blog slug is missing.');
    return { passed: false, score: 0, issues };
  }

  if (!/^[a-z0-9가-힣-]+$/i.test(slug)) {
    addIssue(issues, 'invalid_slug_chars', 'critical', 'Blog slug contains unsupported characters.');
  }

  if (/(?:^|-)q[0-9a-f]{6,10}$/i.test(slug) || /-[0-9a-f]{6,10}$/i.test(slug)) {
    addIssue(issues, 'hash_suffix_slug', 'critical', 'Blog slug ends with a generated hash suffix.');
  }

  if (/(?:^|-)travel-guide(?:-|$)|^(?:guide|post)-[a-z0-9-]+$/i.test(slug)) {
    addIssue(issues, 'generic_travel_guide_slug', 'critical', 'Blog slug is generic instead of reader-facing.');
  }

  if (/^\d+(?:-|$)/.test(slug)) {
    addIssue(issues, 'numeric_leading_slug', 'critical', 'Blog slug starts with a number.');
  }

  if (/(?:^|-)draft(?:-|$)|(?:^|-)test(?:-|$)|(?:^|-)untitled(?:-|$)|(?:^|-)v\d+$/i.test(slug)) {
    addIssue(issues, 'draft_or_test_slug', 'critical', 'Blog slug contains draft, test, or version markers.');
  }

  const requiredTokens = [
    ...keywordTokens(input.primaryKeyword),
    ...keywordTokens(input.destination),
  ];
  if (requiredTokens.length > 0) {
    const tokens = new Set(slugTokens(slug));
    const hasMatch = requiredTokens.some((token) => tokens.has(token) || slug.includes(token));
    if (!hasMatch) {
      addIssue(issues, 'keyword_mismatch_slug', 'warning', 'Blog slug does not reflect the destination or primary keyword.');
    }
  }

  const criticalCount = issues.filter((issue) => issue.severity === 'critical').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  return {
    passed: criticalCount === 0,
    score: Math.max(0, 100 - criticalCount * 30 - warningCount * 10),
    issues,
  };
}
