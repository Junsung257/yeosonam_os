import { supabaseAdmin } from './supabase';
import {
  hashBlogContentRevisionV1,
  type BlogFinalQualityDecisionV1,
} from './blog-quality-decision-v1';

type RevisionTypeV1 = 'generation' | 'opening_repair' | 'full_rewrite';

export interface BlogContentRevisionV1 {
  id: string;
  creativeId: string;
  operationId: string | null;
  parentRevisionId: string | null;
  revisionNo: number;
  revisionType: RevisionTypeV1;
  contentHash: string;
}

type RevisionTableClient = {
  from(table: string): any;
};

function db(): RevisionTableClient {
  return supabaseAdmin as unknown as RevisionTableClient;
}

export async function persistBlogContentRevisionV1(input: {
  creativeId: string;
  operationId?: string | null;
  parentRevisionId?: string | null;
  revisionType: RevisionTypeV1;
  slug: string;
  title: string;
  description: string;
  blogHtml: string;
  claimFingerprint?: string | null;
}): Promise<BlogContentRevisionV1> {
  const contentHash = hashBlogContentRevisionV1({
    blogHtml: input.blogHtml,
    title: input.title,
    description: input.description,
    slug: input.slug,
  });
  const revisionTable = db().from('blog_content_revisions');
  const { data: latest, error: latestError } = await revisionTable
    .select('revision_no')
    .eq('creative_id', input.creativeId)
    .order('revision_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw new Error(`blog_revision_latest_read_failed:${latestError.message}`);
  const revisionNo = Number(latest?.revision_no || 0) + 1;
  const { data, error } = await revisionTable
    .insert({
      creative_id: input.creativeId,
      operation_id: input.operationId ?? null,
      parent_revision_id: input.parentRevisionId ?? null,
      revision_no: revisionNo,
      revision_type: input.revisionType,
      slug: input.slug,
      title: input.title,
      description: input.description,
      blog_html: input.blogHtml,
      content_hash: contentHash,
      claim_fingerprint: input.claimFingerprint ?? null,
    })
    .select('id,creative_id,operation_id,parent_revision_id,revision_no,revision_type,content_hash')
    .single();
  if (error || !data?.id) throw new Error(`blog_revision_insert_failed:${error?.message || 'row_missing'}`);
  return {
    id: String(data.id),
    creativeId: String(data.creative_id),
    operationId: data.operation_id ? String(data.operation_id) : null,
    parentRevisionId: data.parent_revision_id ? String(data.parent_revision_id) : null,
    revisionNo: Number(data.revision_no),
    revisionType: data.revision_type as RevisionTypeV1,
    contentHash: String(data.content_hash),
  };
}

export async function persistBlogQualityDecisionV1(input: {
  decision: BlogFinalQualityDecisionV1;
}): Promise<string> {
  const { decision } = input;
  const { data, error } = await db().from('blog_quality_decisions')
    .insert({
      revision_id: decision.revisionId,
      evaluator_version: decision.evaluatorVersion,
      overall_score: decision.overallScore,
      minimum_score: decision.minimumScore,
      decision: decision.decision,
      passed: decision.passed,
      hard_blockers: decision.hardBlockers,
      warnings: decision.warnings,
      evaluated_content_hash: decision.evaluatedContentHash,
      comparison_corpus_version: decision.comparisonCorpusVersion,
      evaluated_at: decision.evaluatedAt,
    })
    .select('id')
    .single();
  if (error || !data?.id) throw new Error(`blog_quality_decision_insert_failed:${error?.message || 'row_missing'}`);
  return String(data.id);
}

export async function markBlogContentRevisionImmutableV1(revisionId: string): Promise<void> {
  const { error } = await db().from('blog_content_revisions')
    .update({ immutable: true })
    .eq('id', revisionId)
    .eq('immutable', false);
  if (error) throw new Error(`blog_revision_immutable_update_failed:${error.message}`);
}
