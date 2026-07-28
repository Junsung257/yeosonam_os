import { describe, expect, it } from 'vitest';
import { hasReviewedBlogResearchCoverage } from './blog-research-capability';

const registries = [{
  id: 'parks-canada',
  source_type: 'government' as const,
  status: 'active',
}];

describe('reviewed blog research capability', () => {
  it('accepts an intent and destination with a reviewed official document', () => {
    expect(hasReviewedBlogResearchCoverage({
      intent: 'airport_transport',
      destination: '캐나다 로키산맥',
      allowedSourceTypes: ['government', 'transport_operator'],
      registries,
      officialDocuments: [{
        official_source_registry_id: 'parks-canada',
        source_url: 'https://parks.canada.ca/banff-transit',
        intents: ['airport_transport'],
        destinations: ['캐나다 로키산맥', '밴프'],
        status: 'active',
      }],
      reputableSources: [],
    })).toBe(true);
  });

  it('fails closed for a different destination or disallowed source type', () => {
    expect(hasReviewedBlogResearchCoverage({
      intent: 'airport_transport',
      destination: '토론토',
      allowedSourceTypes: ['transport_operator'],
      registries,
      officialDocuments: [{
        official_source_registry_id: 'parks-canada',
        source_url: 'https://parks.canada.ca/banff-transit',
        intents: ['airport_transport'],
        destinations: ['캐나다 로키산맥'],
        status: 'active',
      }],
      reputableSources: [],
    })).toBe(false);
  });
});
