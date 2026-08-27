import { describe, expect, it } from 'vitest';

import { buildProductEntityRelationCandidates } from './entity-relations';

describe('V6.1 product entity relation candidates', () => {
  it('approves exact and approved-alias catalog entities', () => {
    const rows = buildProductEntityRelationCandidates({
      catalogEntities: [{
        id: 'lodging-1',
        entityType: 'lodging',
        canonicalName: '아티타야 리조트',
        aliases: ['아티타야 골프 리조트'],
        revisionId: 'lodging-revision-1',
      }],
      mentions: [
        { entityType: 'lodging', role: 'OVERNIGHT_STAY', sourceMention: '아티타야 리조트', sourceFieldPath: 'days[1].hotel' },
        { entityType: 'lodging', role: 'OVERNIGHT_STAY', sourceMention: '아티타야 골프 리조트', sourceFieldPath: 'days[2].hotel' },
      ],
    });
    expect(rows.map(row => [row.matchState, row.matchMethod, row.canonicalEntityId])).toEqual([
      ['APPROVED', 'EXACT_NORMALIZED', 'lodging-1'],
      ['APPROVED', 'APPROVED_ALIAS', 'lodging-1'],
    ]);
  });

  it('keeps fuzzy attraction matches in review and never creates a master', () => {
    const rows = buildProductEntityRelationCandidates({
      attractions: [
        { id: 'attraction-1', name: '아티타야CC', region: '방콕', aliases: [] },
        { id: 'attraction-2', name: '아티타야 골프장', region: '방콕', aliases: [] },
      ],
      mentions: [{
        entityType: 'attraction',
        role: 'VISIT',
        sourceMention: '아티타야 골프',
        sourceFieldPath: 'days[2].events[0]',
        destination: '방콕',
      }],
    });
    expect(rows[0]?.matchState).toBe('REVIEW_REQUIRED');
    expect(rows[0]?.matchMethod).toBe('FUZZY_CANDIDATE');
    expect(rows[0]?.canonicalAttractionId).toBeNull();
    expect(rows[0]?.candidates.length).toBeGreaterThan(0);
  });

  it('does not invent an entity when no candidate exists', () => {
    const rows = buildProductEntityRelationCandidates({
      mentions: [{
        entityType: 'golf_course',
        role: 'GOLF_ROUND',
        sourceMention: '미등록 골프장',
        sourceFieldPath: 'days[2].events[0]',
      }],
    });
    expect(rows[0]?.matchState).toBe('NOT_FOUND');
    expect(rows[0]?.canonicalEntityId).toBeNull();
  });
});
