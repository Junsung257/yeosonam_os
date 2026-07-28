import type { BlogInformationIntent } from './blog-information-contract';
import type { BlogInformationSourceType } from './blog-information-evidence';
import { matchesBlogResearchDestinationScope } from './blog-research-destination-scope';

export interface BlogResearchRegistryCapability {
  id: string;
  source_type: BlogInformationSourceType;
  status: string;
}

export interface BlogResearchOfficialDocumentCapability {
  official_source_registry_id: string;
  source_url: string;
  intents: string[];
  destinations: string[];
  status: string;
}

export interface BlogResearchReputableCapability {
  source_types: BlogInformationSourceType[];
  intents: string[];
  research_urls: string[];
  research_destinations: string[];
  status: string;
}

function hasAllowedSourceType(
  sourceTypes: BlogInformationSourceType[],
  allowedSourceTypes: readonly string[],
): boolean {
  return sourceTypes.some(sourceType => allowedSourceTypes.includes(sourceType));
}

export function hasReviewedBlogResearchCoverage(input: {
  intent: BlogInformationIntent;
  destination: string;
  allowedSourceTypes: readonly string[];
  registries: BlogResearchRegistryCapability[];
  officialDocuments: BlogResearchOfficialDocumentCapability[];
  reputableSources: BlogResearchReputableCapability[];
}): boolean {
  const activeRegistryTypes = new Map(
    input.registries
      .filter(registry => registry.status === 'active')
      .map(registry => [registry.id, registry.source_type]),
  );
  const hasOfficialDocument = input.officialDocuments.some(document => {
    const sourceType = activeRegistryTypes.get(document.official_source_registry_id);
    return document.status === 'active'
      && document.source_url.startsWith('https://')
      && document.intents.includes(input.intent)
      && Boolean(sourceType && input.allowedSourceTypes.includes(sourceType))
      && matchesBlogResearchDestinationScope({
        destination: input.destination,
        scopes: document.destinations,
      });
  });
  if (hasOfficialDocument) return true;

  return input.reputableSources.some(source =>
    source.status === 'active'
    && source.intents.includes(input.intent)
    && source.research_urls.some(url => url.startsWith('https://'))
    && hasAllowedSourceType(source.source_types, input.allowedSourceTypes)
    && matchesBlogResearchDestinationScope({
      destination: input.destination,
      scopes: source.research_destinations,
    }));
}
