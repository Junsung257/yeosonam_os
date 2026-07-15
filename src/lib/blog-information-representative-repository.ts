import { supabaseAdmin } from './supabase';
import {
  buildBlogInformationRepresentativeKey,
  decideBlogInformationDuplicate,
  readBlogInformationRepresentativeIdentity,
  type BlogInformationDuplicateCandidate,
  type BlogInformationDuplicateDecision,
  type BlogInformationRepresentativeRecord,
} from './blog-information-representative';

function mapRecord(row: Record<string, unknown>): BlogInformationRepresentativeRecord {
  return {
    representativeKey: String(row.representative_key),
    destinationId: String(row.destination_id),
    intent: row.intent as BlogInformationRepresentativeRecord['intent'],
    audience: row.audience as BlogInformationRepresentativeRecord['audience'],
    locale: String(row.locale),
    canonicalCreativeId: typeof row.canonical_creative_id === 'string' ? row.canonical_creative_id : null,
    canonicalSlug: typeof row.canonical_slug === 'string' ? row.canonical_slug : null,
    status: row.status as BlogInformationRepresentativeRecord['status'],
    reservationOwner: String(row.reservation_owner),
  };
}

async function findRepresentative(
  representativeKey: string,
): Promise<BlogInformationRepresentativeRecord | null> {
  const { data, error } = await supabaseAdmin
    .from('blog_information_representatives')
    .select('representative_key, destination_id, intent, audience, locale, canonical_creative_id, canonical_slug, status, reservation_owner')
    .eq('representative_key', representativeKey)
    .limit(1);
  if (error) throw new Error(`blog_information_representative_lookup_failed:${error.message}`);
  return data?.[0] ? mapRecord(data[0] as Record<string, unknown>) : null;
}

export interface BlogInformationRepresentativeReservationStore {
  find(representativeKey: string): Promise<BlogInformationRepresentativeRecord | null>;
  insert(input: {
    representativeKey: string;
    candidate: BlogInformationDuplicateCandidate;
    reservationOwner: string;
  }): Promise<'inserted' | 'conflict'>;
}

const databaseReservationStore: BlogInformationRepresentativeReservationStore = {
  find: findRepresentative,
  async insert(input) {
    const { error } = await supabaseAdmin.from('blog_information_representatives').insert({
      representative_key: input.representativeKey,
      destination_id: input.candidate.destinationId,
      intent: input.candidate.intent,
      audience: input.candidate.audience,
      locale: input.candidate.locale,
      status: 'reserved',
      reservation_owner: input.reservationOwner,
    });
    if (!error) return 'inserted';
    if ((error as { code?: string }).code === '23505') return 'conflict';
    throw new Error(`blog_information_representative_reserve_failed:${error.message}`);
  },
};

export async function reserveBlogInformationRepresentativeWithStore(input: {
  candidate: BlogInformationDuplicateCandidate;
  reservationOwner: string;
}, store: BlogInformationRepresentativeReservationStore): Promise<BlogInformationDuplicateDecision> {
  const representativeKey = buildBlogInformationRepresentativeKey(input.candidate);
  const existing = await store.find(representativeKey);
  if (existing) {
    return decideBlogInformationDuplicate({ candidate: input.candidate, existing, reservationOwner: input.reservationOwner });
  }
  const inserted = await store.insert({ representativeKey, ...input });
  if (inserted === 'inserted') {
    return decideBlogInformationDuplicate({ candidate: input.candidate, existing: null, reservationOwner: input.reservationOwner });
  }
  const raced = await store.find(representativeKey);
  if (!raced) throw new Error('blog_information_representative_race_lookup_failed');
  return decideBlogInformationDuplicate({ candidate: input.candidate, existing: raced, reservationOwner: input.reservationOwner });
}

export async function reserveBlogInformationRepresentative(input: {
  candidate: BlogInformationDuplicateCandidate;
  reservationOwner: string;
}): Promise<BlogInformationDuplicateDecision> {
  return reserveBlogInformationRepresentativeWithStore(input, databaseReservationStore);
}

export async function activateBlogInformationRepresentative(input: {
  representativeKey: string;
  reservationOwner: string;
  creativeId: string;
  canonicalSlug: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('blog_information_representatives')
    .update({
      canonical_creative_id: input.creativeId,
      canonical_slug: input.canonicalSlug,
      status: 'active',
      activated_at: now,
      updated_at: now,
    })
    .eq('representative_key', input.representativeKey)
    .eq('reservation_owner', input.reservationOwner)
    .select('representative_key');
  if (error) throw new Error(`blog_information_representative_activate_failed:${error.message}`);
  if (!data || data.length !== 1) throw new Error('blog_information_representative_activation_owner_mismatch');
}

export async function attachBlogInformationRepresentativeDraft(input: {
  representativeKey: string;
  reservationOwner: string;
  creativeId: string;
  canonicalSlug: string;
}): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('blog_information_representatives')
    .update({
      canonical_creative_id: input.creativeId,
      canonical_slug: input.canonicalSlug,
      updated_at: new Date().toISOString(),
    })
    .eq('representative_key', input.representativeKey)
    .eq('reservation_owner', input.reservationOwner)
    .eq('status', 'reserved')
    .select('representative_key');
  if (error) throw new Error(`blog_information_representative_attach_draft_failed:${error.message}`);
  if (!data || data.length !== 1) throw new Error('blog_information_representative_draft_owner_mismatch');
}

export async function ensureBlogInformationRepresentativeForPublish(input: {
  creativeId: string;
  slug: string;
  title: string;
  markdown: string;
  productId?: string | null;
  generationMeta?: Record<string, unknown> | null;
}): Promise<{ representativeKey: string; canonicalSlug: string } | null> {
  if (input.productId) return null;
  const identity = readBlogInformationRepresentativeIdentity(input.generationMeta);
  if (!identity) throw new Error('blog_information_representative_identity_missing');
  const representativeKey = buildBlogInformationRepresentativeKey(identity);
  const existing = await findRepresentative(representativeKey);
  if (existing?.status === 'active') {
    if (existing.canonicalCreativeId !== input.creativeId || existing.canonicalSlug !== input.slug) {
      throw new Error(`blog_information_representative_duplicate:${existing.canonicalSlug || representativeKey}`);
    }
    return { representativeKey, canonicalSlug: input.slug };
  }
  if (existing?.status === 'retired') {
    throw new Error('blog_information_representative_retired_requires_review');
  }
  if (existing?.status === 'reserved') {
    if (existing.canonicalCreativeId !== input.creativeId) {
      throw new Error(`blog_information_representative_reserved:${existing.canonicalSlug || representativeKey}`);
    }
    await activateBlogInformationRepresentative({
      representativeKey,
      reservationOwner: existing.reservationOwner,
      creativeId: input.creativeId,
      canonicalSlug: input.slug,
    });
    return { representativeKey, canonicalSlug: input.slug };
  }

  const reservationOwner = `content_creative:${input.creativeId}`;
  const decision = await reserveBlogInformationRepresentative({
    reservationOwner,
    candidate: { ...identity, slug: input.slug, title: input.title, markdown: input.markdown },
  });
  if (!['RESERVE_CREATE', 'RESUME_RESERVATION'].includes(decision.action)) {
    throw new Error(`blog_information_representative_duplicate:${decision.canonicalSlug || decision.reason}`);
  }
  await activateBlogInformationRepresentative({
    representativeKey,
    reservationOwner,
    creativeId: input.creativeId,
    canonicalSlug: input.slug,
  });
  return { representativeKey, canonicalSlug: input.slug };
}
