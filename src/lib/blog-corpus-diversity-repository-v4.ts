import { belongsToBlogReplacementLineage } from '@/lib/blog-corpus-lineage-v3';
import {
  decideBlogDuplicateDispositionV3,
  evaluateBlogCorpusCandidateV3,
  type BlogCorpusCandidateV3,
  type BlogCorpusDiversityEvaluationV3,
} from '@/lib/blog-corpus-diversity-v3';
import {
  isKoreanSemanticBenchmarkPassingV4,
  maximumKoreanSemanticSimilarityV4,
  type BlogKoreanSemanticBenchmarkRowV4,
} from '@/lib/blog-korean-semantic-v4';
import { supabaseAdmin } from '@/lib/supabase';

export async function loadBlogCorpusDiversityV4(input: {
  queueItemId: string;
  excludeCreativeId?: string | null;
  replacementTargetCreativeId?: string | null;
  title: string;
  body: string;
  destination?: string | null;
}): Promise<{ report: BlogCorpusDiversityEvaluationV3 | null; error: string | null }> {
  const [creativesResult, queueResult, representativesResult] = await Promise.all([
    supabaseAdmin.from('content_creatives')
      .select('id, seo_title, title, blog_html, destination, status, generation_meta')
      .eq('channel', 'naver_blog').in('status', ['published', 'draft']),
    supabaseAdmin.from('blog_topic_queue')
      .select('id, topic, destination, status, meta').in('status', ['queued', 'generating', 'pending_review']),
    supabaseAdmin.from('blog_information_representatives')
      .select('canonical_creative_id, canonical_slug, destination_id, status').eq('status', 'active'),
  ]);
  const failures = [creativesResult.error, queueResult.error, representativesResult.error]
    .filter(Boolean).map((error) => error?.message || 'unknown_error');
  if (failures.length) return { report: null, error: `corpus_lookup_failed:${failures.join('|')}` };

  const corpus: BlogCorpusCandidateV3[] = [];
  for (const row of creativesResult.data || []) {
    if (input.excludeCreativeId && row.id === input.excludeCreativeId) continue;
    if (belongsToBlogReplacementLineage({ id: row.id, meta: row.generation_meta, replacementTargetCreativeId: input.replacementTargetCreativeId })) continue;
    corpus.push({
      title: String(row.seo_title || row.title || ''), body: typeof row.blog_html === 'string' ? row.blog_html : null,
      destination: typeof row.destination === 'string' ? row.destination : null,
      source: row.status === 'draft' ? 'draft' : 'published',
    });
  }
  for (const row of queueResult.data || []) {
    if (row.id === input.queueItemId) continue;
    if (belongsToBlogReplacementLineage({ meta: row.meta, replacementTargetCreativeId: input.replacementTargetCreativeId })) continue;
    corpus.push({
      title: String(row.topic || ''), destination: typeof row.destination === 'string' ? row.destination : null, source: 'queued',
    });
  }
  for (const row of representativesResult.data || []) {
    if (!row.canonical_slug || row.canonical_creative_id === input.replacementTargetCreativeId) continue;
    corpus.push({
      title: String(row.canonical_slug).replace(/-/g, ' '),
      destination: typeof row.destination_id === 'string' ? row.destination_id : null, source: 'representative',
    });
  }
  const report = evaluateBlogCorpusCandidateV3({ title: input.title, body: input.body, destination: input.destination }, corpus.filter((row) => row.title.trim().length > 0));
  const { data: semanticBenchmark } = await supabaseAdmin.from('blog_adapter_benchmarks')
    .select('adapter,adapter_version,sample_size,precision,recall,passed')
    .eq('adapter', 'korean_semantic').order('evaluated_at', { ascending: false }).limit(1).maybeSingle();
  if (isKoreanSemanticBenchmarkPassingV4(semanticBenchmark as BlogKoreanSemanticBenchmarkRowV4 | null)) {
    const destination = String(input.destination || '').normalize('NFKC').toLocaleLowerCase('ko-KR');
    const comparable = corpus.filter((row) => !destination
      || String(row.destination || '').normalize('NFKC').toLocaleLowerCase('ko-KR') === destination);
    const similarity = maximumKoreanSemanticSimilarityV4(
      `${input.title}\n${input.body.slice(0, 1_500)}`,
      comparable.map((row) => `${row.title}\n${String(row.body || '').slice(0, 1_500)}`),
    );
    const semanticDecision = decideBlogDuplicateDispositionV3({
      exactTitle: report.exactTitleDuplicate,
      normalizedTitleCanaryCount: report.normalizedTitleClusterSize,
      headingSimilarity: report.maxHeadingSimilarity,
      bodySimilarity: report.maxBodySimilarity,
      sameIntentEmbeddingCosine: similarity,
    });
    if (semanticDecision.reasons.includes('same_intent_semantic_duplicate')) {
      report.disposition = semanticDecision.disposition;
      report.reasons = [...new Set([...report.reasons, ...semanticDecision.reasons])];
      report.evidence = [{ source: 'whole_corpus', title: input.title, metric: 'korean_semantic_embedding', similarity }, ...report.evidence].slice(0, 20);
    }
  }
  return { report, error: null };
}
