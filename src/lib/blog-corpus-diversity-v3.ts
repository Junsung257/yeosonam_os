import { createHash } from 'node:crypto';

export interface BlogNormalizationEntitiesV3 {
  countries?: string[];
  cities?: string[];
  airports?: string[];
  hotels?: string[];
  attractions?: string[];
  airlines?: string[];
}

const MONTH_SEASON = /(?:1[0-2]|[1-9])\s*월|봄|여름|가을|겨울|spring|summer|autumn|fall|winter/giu;
const DATE_TIME_NUMBER = /\b(?:19|20)\d{2}\b|\d{1,2}:\d{2}|\d+(?:[.,]\d+)?\s*(?:원|달러|유로|엔|위안|바트|동|km|m|분|시간|일|박|월|년)?/giu;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function normalizeBlogCorpusTextV3(
  value: string,
  entities: BlogNormalizationEntitiesV3 = {},
): string {
  let output = value.normalize('NFKC').toLowerCase();
  const groups: Array<[keyof BlogNormalizationEntitiesV3, string]> = [
    ['countries', '{country}'], ['cities', '{city}'], ['airports', '{airport}'],
    ['hotels', '{hotel}'], ['attractions', '{attraction}'], ['airlines', '{airline}'],
  ];
  for (const [key, token] of groups) {
    const values = [...(entities[key] || [])].sort((a, b) => b.length - a.length);
    if (values.length) output = output.replace(new RegExp(values.map(escapeRegExp).join('|'), 'giu'), token);
  }
  return output
    .replace(MONTH_SEASON, '{season}')
    .replace(DATE_TIME_NUMBER, '{number}')
    .replace(/[“”"'`*_#>|()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeBlogTitleSkeletonV3(title: string, entities?: BlogNormalizationEntitiesV3): string {
  return normalizeBlogCorpusTextV3(title, entities)
    .replace(/\((?:2|3|4|5)편\)$/u, '')
    .trim();
}

export function extractBlogHeadingTreeV3(markdown: string, entities?: BlogNormalizationEntitiesV3): string[] {
  return [...markdown.matchAll(/^\s*(#{2,3})\s+(.+)$/gmu)]
    .map((match) => `${match[1].length}:${normalizeBlogCorpusTextV3(match[2], entities)}`);
}

export function sentenceFiveGramsV3(value: string): Set<string> {
  const sentences = value.split(/(?<=[.!?。！？])\s+|\n+/u).map((v) => v.trim()).filter(Boolean);
  const grams = new Set<string>();
  for (let i = 0; i <= sentences.length - 5; i += 1) grams.add(sentences.slice(i, i + 5).join(' '));
  return grams;
}

export function jaccardSimilarityV3<T>(left: Set<T>, right: Set<T>): number {
  if (left.size === 0 && right.size === 0) return 1;
  const intersection = [...left].filter((item) => right.has(item)).length;
  return intersection / (left.size + right.size - intersection);
}

export function minHashSignatureV3(value: string, size = 64): number[] {
  const tokens = normalizeBlogCorpusTextV3(value).split(/\s+/).filter(Boolean);
  const shingles = new Set<string>();
  for (let i = 0; i <= tokens.length - 5; i += 1) shingles.add(tokens.slice(i, i + 5).join(' '));
  if (shingles.size === 0) return [];
  return Array.from({ length: size }, (_, seed) => Math.min(...[...shingles].map((shingle) => {
    const digest = createHash('sha256').update(`${seed}:${shingle}`).digest();
    return digest.readUInt32BE(0);
  })));
}

export function minHashSimilarityV3(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0;
  return left.filter((value, index) => value === right[index]).length / left.length;
}

export type BlogDuplicateDispositionV3 = 'allow' | 'warn' | 'refresh' | 'append' | 'merge' | 'canonical_update' | 'queue_reject';

export interface BlogCorpusCandidateV3 {
  title: string;
  body?: string | null;
  destination?: string | null;
  source?: 'published' | 'draft' | 'queued' | 'representative';
}

export interface BlogCorpusDiversityEvaluationV3 {
  exactTitleDuplicate: boolean;
  normalizedTitleClusterSize: number;
  maxHeadingSimilarity: number;
  maxBodySimilarity: number;
  maxOpeningSimilarity: number;
  disposition: BlogDuplicateDispositionV3;
  reasons: string[];
  comparedCount: number;
  evidence: Array<{ source: string; title: string; metric: string; similarity: number }>;
}

function firstParagraph(value: string): string {
  return value
    .replace(/^---[\s\S]*?---\s*/u, '')
    .replace(/<!--[\s\S]*?-->/gu, '')
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    // A Markdown heading is document identity/structure, not an opening
    // paragraph. Comparing H1 text here made ordinary title keywords look
    // like duplicated prose and could quarantine an otherwise unique post.
    .filter((paragraph) => !/^#{1,6}\s+/u.test(paragraph))
    .find(Boolean) || '';
}

/**
 * Evaluates one candidate against the caller-provided whole corpus. The caller is
 * responsible for including published, private drafts, queued topics and current
 * representatives; this function deliberately has no recent-N shortcut.
 */
export function evaluateBlogCorpusCandidateV3(
  candidate: BlogCorpusCandidateV3,
  corpus: BlogCorpusCandidateV3[],
): BlogCorpusDiversityEvaluationV3 {
  const destinations = [...new Set([candidate.destination, ...corpus.map((row) => row.destination)].filter(Boolean))] as string[];
  const entities: BlogNormalizationEntitiesV3 = { cities: destinations };
  const candidateTitle = candidate.title.normalize('NFKC').trim().toLowerCase();
  const candidateSkeleton = normalizeBlogTitleSkeletonV3(candidate.title, entities);
  const candidateHeadings = new Set(extractBlogHeadingTreeV3(candidate.body || '', entities));
  const candidateBody = minHashSignatureV3(candidate.body || '');
  const candidateOpening = new Set(normalizeBlogCorpusTextV3(firstParagraph(candidate.body || ''), entities).split(/\s+/u).filter(Boolean));
  let exactTitleDuplicate = false;
  let normalizedTitleClusterSize = 0;
  let maxHeadingSimilarity = 0;
  let maxBodySimilarity = 0;
  let maxOpeningSimilarity = 0;
  const evidence: BlogCorpusDiversityEvaluationV3['evidence'] = [];

  for (const row of corpus) {
    const source = row.source || 'published';
    const rowTitle = row.title.normalize('NFKC').trim().toLowerCase();
    if (rowTitle === candidateTitle) {
      exactTitleDuplicate = true;
      evidence.push({ source, title: row.title, metric: 'exact_title', similarity: 1 });
    }
    if (normalizeBlogTitleSkeletonV3(row.title, entities) === candidateSkeleton) normalizedTitleClusterSize += 1;
    if (!row.body) continue;
    const headingSimilarity = jaccardSimilarityV3(candidateHeadings, new Set(extractBlogHeadingTreeV3(row.body, entities)));
    const bodySimilarity = minHashSimilarityV3(candidateBody, minHashSignatureV3(row.body));
    const openingSimilarity = jaccardSimilarityV3(
      candidateOpening,
      new Set(normalizeBlogCorpusTextV3(firstParagraph(row.body), entities).split(/\s+/u).filter(Boolean)),
    );
    maxHeadingSimilarity = Math.max(maxHeadingSimilarity, headingSimilarity);
    maxBodySimilarity = Math.max(maxBodySimilarity, bodySimilarity);
    maxOpeningSimilarity = Math.max(maxOpeningSimilarity, openingSimilarity);
    if (headingSimilarity >= 0.65) evidence.push({ source, title: row.title, metric: 'heading_tree', similarity: headingSimilarity });
    if (bodySimilarity >= 0.72) evidence.push({ source, title: row.title, metric: 'body_minhash', similarity: bodySimilarity });
    if (openingSimilarity >= 0.75) evidence.push({ source, title: row.title, metric: 'opening', similarity: openingSimilarity });
  }
  const decision = decideBlogDuplicateDispositionV3({
    exactTitle: exactTitleDuplicate,
    normalizedTitleCanaryCount: normalizedTitleClusterSize + 1,
    headingSimilarity: maxHeadingSimilarity,
    bodySimilarity: maxBodySimilarity,
  });
  if (maxOpeningSimilarity >= 0.75) decision.reasons.push('opening_similarity_warning');
  return {
    exactTitleDuplicate,
    normalizedTitleClusterSize: normalizedTitleClusterSize + 1,
    maxHeadingSimilarity,
    maxBodySimilarity,
    maxOpeningSimilarity,
    disposition: decision.disposition,
    reasons: [...new Set(decision.reasons)],
    comparedCount: corpus.length,
    evidence: evidence.sort((a, b) => b.similarity - a.similarity).slice(0, 20),
  };
}

export function decideBlogDuplicateDispositionV3(input: {
  exactTitle: boolean;
  normalizedTitleCanaryCount: number;
  headingSimilarity: number;
  bodySimilarity: number;
  sameIntentEmbeddingCosine?: number | null;
  isCanonicalUpdate?: boolean;
}): { disposition: BlogDuplicateDispositionV3; reasons: string[] } {
  const reasons: string[] = [];
  if (input.exactTitle) return { disposition: 'queue_reject', reasons: ['exact_title_duplicate'] };
  if (input.normalizedTitleCanaryCount >= 3) return { disposition: 'queue_reject', reasons: ['title_skeleton_saturated'] };
  if (Number(input.sameIntentEmbeddingCosine || 0) >= 0.88) {
    return { disposition: input.isCanonicalUpdate ? 'canonical_update' : 'merge', reasons: ['same_intent_semantic_duplicate'] };
  }
  if (input.bodySimilarity >= 0.72) return { disposition: 'refresh', reasons: ['body_minhash_duplicate'] };
  if (input.headingSimilarity >= 0.65) reasons.push('heading_tree_similarity_warning');
  return { disposition: reasons.length ? 'warn' : 'allow', reasons };
}
