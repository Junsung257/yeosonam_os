import { inspectBlogSlugQuality } from './blog-slug-quality';
import { slugifyTopic } from './slug-utils';
import { readProgrammaticExpectedSlug } from './blog-programmatic-contract';

export type BlogCandidatePrepublishIssueCode =
  | 'editorial_cliche_topic'
  | 'machine_topic_separator'
  | 'risky_numeric_slug_topic'
  | 'broad_generic_recommendation'
  | 'weak_expected_slug';

export type BlogCandidatePrepublishRow = {
  topic?: string | null;
  destination?: string | null;
  primary_keyword?: string | null;
  slug?: string | null;
  slug_hint?: string | null;
  meta?: Record<string, unknown> | null;
  generation_meta?: Record<string, unknown> | null;
};

export type BlogCandidatePrepublishIssue = {
  code: BlogCandidatePrepublishIssueCode;
  severity: 'critical' | 'warning';
  message: string;
  evidence?: Record<string, unknown>;
};

export type BlogCandidatePrepublishReport = {
  passed: boolean;
  score: number;
  issues: BlogCandidatePrepublishIssue[];
};

const EDITORIAL_CLICHE_TOPIC_RE =
  /(?:\uCD1D\uC815\uB9AC|\uC644\uBCBD\s*(?:\uAC00\uC774\uB4DC|\uC815\uB9AC|\uCCB4\uD06C\uB9AC\uC2A4\uD2B8)|\uC644\uBCBD\uD55C)/;
const MACHINE_TOPIC_SEPARATOR_RE = /\|/;
const RISKY_LEADING_NUMERIC_RE = /^\s*(?:20\d{2}|\d{1,2}\s*(?:\uC6D4|month))/i;
const BROAD_GENERIC_RECOMMENDATION_RE =
  /(?:\uC5EC\uD589\uC9C0|\uD574\uC678\uC5EC\uD589|\uD734\uC591\uC9C0).*(?:\uCD94\uCC9C|\uC544\uC774|\uAC00\uC871)|(?:\uC544\uC774|\uAC00\uC871).*(?:\uC5EC\uD589\uC9C0|\uD574\uC678\uC5EC\uD589|\uD734\uC591\uC9C0).*(?:\uCD94\uCC9C)/;

function readString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function addIssue(
  issues: BlogCandidatePrepublishIssue[],
  code: BlogCandidatePrepublishIssueCode,
  severity: BlogCandidatePrepublishIssue['severity'],
  message: string,
  evidence?: Record<string, unknown>,
): void {
  issues.push({ code, severity, message, evidence });
}

function readExpectedSlug(row: BlogCandidatePrepublishRow): string | null {
  return readString(
    row.meta?.expected_slug,
    row.meta?.spun_slug,
    row.generation_meta?.expected_slug,
    row.slug_hint,
    row.slug,
  ) ?? readProgrammaticExpectedSlug({ meta: row.meta, topic: row.topic });
}

function probeSlug(row: BlogCandidatePrepublishRow, topic: string): string | null {
  const expected = readExpectedSlug(row);
  if (expected) return expected;
  if (RISKY_LEADING_NUMERIC_RE.test(topic) || MACHINE_TOPIC_SEPARATOR_RE.test(topic)) {
    return slugifyTopic(topic);
  }
  return null;
}

export function inspectBlogCandidatePrepublishContract(
  row: BlogCandidatePrepublishRow,
): BlogCandidatePrepublishReport {
  const issues: BlogCandidatePrepublishIssue[] = [];
  const topic = readString(row.topic, row.primary_keyword) ?? '';

  if (EDITORIAL_CLICHE_TOPIC_RE.test(topic)) {
    addIssue(
      issues,
      'editorial_cliche_topic',
      'critical',
      'Candidate topic contains a banned blog cliche such as complete guide or total summary.',
      { topic },
    );
  }

  if (MACHINE_TOPIC_SEPARATOR_RE.test(topic)) {
    addIssue(
      issues,
      'machine_topic_separator',
      'critical',
      'Candidate topic contains machine-style separator characters that often produce weak titles or slugs.',
      { topic },
    );
  }

  if (RISKY_LEADING_NUMERIC_RE.test(topic)) {
    addIssue(
      issues,
      'risky_numeric_slug_topic',
      'critical',
      'Candidate topic starts with a year or month and is likely to generate a numeric-leading slug.',
      { topic },
    );
  }

  if (!readString(row.destination) && BROAD_GENERIC_RECOMMENDATION_RE.test(topic)) {
    addIssue(
      issues,
      'broad_generic_recommendation',
      'critical',
      'Destinationless broad recommendation candidates need a concrete comparison brief before autonomous publishing.',
      { topic },
    );
  }

  const slug = probeSlug(row, topic);
  if (slug) {
    const slugQuality = inspectBlogSlugQuality({
      slug,
      primaryKeyword: readString(row.primary_keyword, row.topic),
      destination: row.destination,
    });
    if (!slugQuality.passed) {
      addIssue(
        issues,
        'weak_expected_slug',
        'critical',
        'Candidate expected slug fails the blog slug quality contract.',
        {
          slug,
          issue_codes: slugQuality.issues.map((issue) => issue.code),
        },
      );
    }
  }

  const criticalCount = issues.filter((issue) => issue.severity === 'critical').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  return {
    passed: criticalCount === 0,
    score: Math.max(0, 100 - criticalCount * 30 - warningCount * 8),
    issues,
  };
}
