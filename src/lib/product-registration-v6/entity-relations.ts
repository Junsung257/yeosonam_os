import { sha256Hex } from '@/lib/product-registration-v4/document-ir';
import {
  attractionReviewCandidates,
  matchAttractionForRegistration,
  type AttractionData,
} from '@/lib/attraction-matcher';

export type RegistrationEntityType = 'lodging' | 'golf_course' | 'airline' | 'airport' | 'attraction' | 'property_complex';
export type RegistrationMatchState = 'APPROVED' | 'REVIEW_REQUIRED' | 'NOT_FOUND' | 'CONFLICTING';
export type RegistrationMatchMethod = 'EXACT_NORMALIZED' | 'APPROVED_ALIAS' | 'MANUAL' | 'FUZZY_CANDIDATE' | 'UNRESOLVED';

export type CatalogEntityCandidate = {
  id: string;
  entityType: Exclude<RegistrationEntityType, 'attraction'>;
  canonicalName: string;
  aliases?: string[];
  revisionId?: string | null;
};

export type ProductEntityMention = {
  entityType: RegistrationEntityType;
  role: string;
  sourceMention: string;
  sourceFieldPath: string;
  dayIndexes?: number[];
  destination?: string | null;
};

export type ProductEntityRelationCandidate = {
  entityType: RegistrationEntityType;
  role: string;
  sourceMention: string;
  sourceFieldPath: string;
  canonicalEntityId: string | null;
  entityRevisionId: string | null;
  canonicalAttractionId: string | null;
  approvedAliasId: number | null;
  matchState: RegistrationMatchState;
  matchMethod: RegistrationMatchMethod;
  dayIndexes: number[];
  candidates: Array<{ id: string | null; name: string; score: number }>;
  evidence: unknown[];
  sourceHash: string;
};

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s()（）\[\]·•・,，.。:：;；'"`!?_-]+/gu, '');
}

function relationHash(mention: ProductEntityMention): string {
  return sha256Hex(JSON.stringify({
    entityType: mention.entityType,
    role: mention.role,
    sourceMention: mention.sourceMention,
    sourceFieldPath: mention.sourceFieldPath,
  }));
}

/**
 * Resolves only existing catalog/attraction records. Fuzzy candidates are
 * emitted for review and never become a customer revision link. In
 * particular, this function has no INSERT capability and does not seed the
 * attractions SSOT.
 */
export function buildProductEntityRelationCandidates(input: {
  mentions: ProductEntityMention[];
  catalogEntities?: CatalogEntityCandidate[];
  attractions?: AttractionData[];
}): ProductEntityRelationCandidate[] {
  const catalog = input.catalogEntities ?? [];
  const attractions = input.attractions ?? [];
  return input.mentions.map(mention => {
    const candidates = mention.entityType === 'attraction'
      ? attractionReviewCandidates(mention.sourceMention, attractions, mention.destination ?? undefined).candidates
      : [];
    if (mention.entityType === 'attraction') {
      const exact = matchAttractionForRegistration(mention.sourceMention, attractions, mention.destination ?? undefined);
      if (exact?.id) {
        const approvedAlias = (exact.aliases ?? []).some(alias => normalize(alias) === normalize(mention.sourceMention));
        return {
          entityType: mention.entityType,
          role: mention.role,
          sourceMention: mention.sourceMention,
          sourceFieldPath: mention.sourceFieldPath,
          canonicalEntityId: null,
          entityRevisionId: null,
          canonicalAttractionId: exact.id,
          approvedAliasId: null,
          matchState: 'APPROVED',
          matchMethod: approvedAlias ? 'APPROVED_ALIAS' : 'EXACT_NORMALIZED',
          dayIndexes: mention.dayIndexes ?? [],
          candidates: [],
          evidence: [],
          sourceHash: relationHash(mention),
        };
      }
    } else {
      const identifier = normalize(mention.sourceMention);
      const exact = catalog.filter(entity => entity.entityType === mention.entityType
        && normalize(entity.canonicalName) === identifier);
      const alias = catalog.filter(entity => entity.entityType === mention.entityType
        && (entity.aliases ?? []).some(value => normalize(value) === identifier));
      const approved = exact.length === 1 ? exact[0] : alias.length === 1 ? alias[0] : null;
      if (approved) {
        return {
          entityType: mention.entityType,
          role: mention.role,
          sourceMention: mention.sourceMention,
          sourceFieldPath: mention.sourceFieldPath,
          canonicalEntityId: approved.id,
          entityRevisionId: approved.revisionId ?? null,
          canonicalAttractionId: null,
          approvedAliasId: null,
          matchState: 'APPROVED',
          matchMethod: exact.length === 1 ? 'EXACT_NORMALIZED' : 'APPROVED_ALIAS',
          dayIndexes: mention.dayIndexes ?? [],
          candidates: [],
          evidence: [],
          sourceHash: relationHash(mention),
        };
      }
    }
    return {
      entityType: mention.entityType,
      role: mention.role,
      sourceMention: mention.sourceMention,
      sourceFieldPath: mention.sourceFieldPath,
      canonicalEntityId: null,
      entityRevisionId: null,
      canonicalAttractionId: null,
      approvedAliasId: null,
      matchState: candidates.length ? 'REVIEW_REQUIRED' : 'NOT_FOUND',
      matchMethod: candidates.length ? 'FUZZY_CANDIDATE' : 'UNRESOLVED',
      dayIndexes: mention.dayIndexes ?? [],
      candidates,
      evidence: [],
      sourceHash: relationHash(mention),
    };
  });
}
