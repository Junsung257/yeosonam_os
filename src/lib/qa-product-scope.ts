export type QaProductScopePackage = {
  id?: unknown;
  title?: unknown;
  display_title?: unknown;
  destination?: unknown;
  internal_code?: unknown;
  short_code?: unknown;
};

export type QaProductScopeResult<T extends QaProductScopePackage> = {
  packages: T[];
  selectedIds: string[];
  mode: 'explicit_product' | 'ambiguous_product' | 'destination_or_general';
  reason: string | null;
};

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const PACKAGE_LINK_RE = /\/packages\/([a-zA-Z0-9-]+)/g;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalize(value: unknown): string {
  return text(value)
    .normalize('NFC')
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(value: unknown): string {
  return normalize(value).replace(/\s+/g, '');
}

function compactCodeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function packageId(pkg: QaProductScopePackage): string {
  return text(pkg.id);
}

function extractMentionedIds(source: string): Set<string> {
  const ids = new Set<string>();
  for (const match of source.matchAll(PACKAGE_LINK_RE)) ids.add(match[1]);
  for (const match of source.matchAll(UUID_RE)) ids.add(match[0]);
  return ids;
}

function quotedPhrases(source: string): string[] {
  return [...source.matchAll(/"([^"]{4,120})"|'([^']{4,120})'|“([^”]{4,120})”|‘([^’]{4,120})’|「([^」]{4,120})」|『([^』]{4,120})』/g)]
    .map((match) => normalize(match.slice(1).find(Boolean)))
    .filter(Boolean);
}

function codeTokens(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/[a-zA-Z0-9][a-zA-Z0-9-]{3,}[a-zA-Z0-9]/g)]
      .map((match) => compactCodeToken(match[0]))
      .filter((token) => token.length >= 5),
  );
}

function titleTokens(value: unknown): string[] {
  return normalize(value)
    .split(' ')
    .filter((token) => token.length >= 2 && !/^\d+$/.test(token));
}

function titleOverlapScore(query: string, title: unknown): number {
  const tokens = titleTokens(title);
  if (tokens.length === 0) return 0;
  const queryNorm = normalize(query);
  const hits = tokens.filter((token) => queryNorm.includes(token)).length;
  return hits / tokens.length;
}

function codeMentioned(queryCodeTokens: Set<string>, code: unknown): boolean {
  const raw = text(code);
  if (!raw) return false;
  const variants = new Set([
    compactCodeToken(raw),
    compactCodeToken(raw.replace(/^PUS-|^ICN-|^GMP-/i, '')),
  ]);
  variants.delete('');
  return [...variants].some((variant) => queryCodeTokens.has(variant));
}

export function scopeQaPackagesToExplicitProduct<T extends QaProductScopePackage>(
  packages: T[],
  source: string,
): QaProductScopeResult<T> {
  const sourceNorm = normalize(source);
  const sourceCompact = compact(source);
  const sourceCodeTokens = codeTokens(source);
  const mentionedIds = extractMentionedIds(source);
  const quoted = quotedPhrases(source);

  const byId = packages.filter((pkg) => mentionedIds.has(packageId(pkg)));
  if (byId.length > 0) {
    return {
      packages: byId,
      selectedIds: byId.map(packageId).filter(Boolean),
      mode: 'explicit_product',
      reason: 'package_id_or_link',
    };
  }

  const byCode = packages.filter((pkg) =>
    codeMentioned(sourceCodeTokens, pkg.internal_code) || codeMentioned(sourceCodeTokens, pkg.short_code),
  );
  if (byCode.length > 0) {
    if (byCode.length > 1) {
      return {
        packages: byCode,
        selectedIds: byCode.map(packageId).filter(Boolean),
        mode: 'ambiguous_product',
        reason: 'ambiguous_product_code',
      };
    }
    return {
      packages: byCode,
      selectedIds: byCode.map(packageId).filter(Boolean),
      mode: 'explicit_product',
      reason: 'product_code',
    };
  }

  const byExactTitle = packages.filter((pkg) => {
    const title = normalize(pkg.display_title) || normalize(pkg.title);
    if (!title || title.length < 6) return false;
    if (sourceNorm.includes(title)) return true;
    const titleCompact = title.replace(/\s+/g, '');
    if (titleCompact.length >= 8 && sourceCompact.includes(titleCompact)) return true;
    return quoted.some((phrase) => phrase.length >= 4 && title.includes(phrase));
  });
  if (byExactTitle.length > 0) {
    if (byExactTitle.length > 1) {
      return {
        packages: byExactTitle,
        selectedIds: byExactTitle.map(packageId).filter(Boolean),
        mode: 'ambiguous_product',
        reason: 'ambiguous_exact_title',
      };
    }
    return {
      packages: byExactTitle,
      selectedIds: byExactTitle.map(packageId).filter(Boolean),
      mode: 'explicit_product',
      reason: 'exact_title',
    };
  }

  const scored = packages
    .map((pkg) => ({
      pkg,
      score: Math.max(
        titleOverlapScore(source, pkg.display_title),
        titleOverlapScore(source, pkg.title),
      ),
    }))
    .filter((row) => row.score >= 0.72)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    const topScore = scored[0].score;
    const top = scored.filter((row) => topScore - row.score <= 0.05).map((row) => row.pkg);
    if (top.length === 1) {
      return {
        packages: top,
        selectedIds: top.map(packageId).filter(Boolean),
        mode: 'explicit_product',
        reason: 'title_token_overlap',
      };
    }
    if (top.length <= 3) {
      return {
        packages: top,
        selectedIds: top.map(packageId).filter(Boolean),
        mode: 'ambiguous_product',
        reason: 'ambiguous_title_token_overlap',
      };
    }
  }

  return {
    packages,
    selectedIds: [],
    mode: 'destination_or_general',
    reason: null,
  };
}
