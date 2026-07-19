import { describe, expect, it } from 'vitest';
import { resolveBlogInformationOfficialSourceTrust } from './blog-information-official-source';

const registry = [{
  id: 'registry-1',
  hostname: 'government.example',
  sourceType: 'government' as const,
  authorityLevel: 'official_primary' as const,
  allowSubdomains: false,
}];

describe('blog information official source trust', () => {
  it('derives official authority only from an exact reviewed registry entry', () => {
    expect(resolveBlogInformationOfficialSourceTrust({
      sourceUrl: 'https://government.example/policy',
      sourceType: 'government',
      registry,
    })).toEqual({ registryId: 'registry-1', authorityLevel: 'official_primary' });
  });

  it.each([
    'https://evil.example/policy',
    'https://government.example.evil.com/policy',
    'https://user@government.example/policy',
    'http://government.example/policy',
    'https://government.example:444/policy',
  ])('rejects a caller-controlled official URL: %s', (sourceUrl) => {
    expect(resolveBlogInformationOfficialSourceTrust({
      sourceUrl,
      sourceType: 'government',
      registry,
    })).toBeNull();
  });

  it('does not reuse a registry entry for a different source type', () => {
    expect(resolveBlogInformationOfficialSourceTrust({
      sourceUrl: 'https://government.example/policy',
      sourceType: 'airport',
      registry,
    })).toBeNull();
  });
});
