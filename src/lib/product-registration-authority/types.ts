import type { CanonicalSection } from '@/lib/product-registration-v4/canonical-worker';
import type { ProductRegistrationV5RevisionBuild } from '@/lib/product-registration-v4/revision';
import type { ProductRegistrationV6DomainProjection } from '@/lib/product-registration-v6/domain-projections';

export const PLATFORM_PRODUCT_REGISTRATION_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export type ProductRegistrationAuthorityMode = 'legacy' | 'shadow' | 'kernel';

export type CommitCanonicalRevisionInput = {
  tenantId: string;
  productKey: string;
  sourceChannel: string;
  operationKey: string;
  build: ProductRegistrationV5RevisionBuild;
  sections: CanonicalSection[];
  domainProjection: ProductRegistrationV6DomainProjection;
  catalogProductId?: string | null;
};

export type CommittedCanonicalRevision = {
  tenantId: string;
  catalogProductId: string;
  revisionId: string;
  revisionHash: string;
  inserted: boolean;
  claimCount: number;
  priceRuleCount: number;
  itineraryItemCount: number;
  domainRowCount: number;
  authorityMode: ProductRegistrationAuthorityMode;
};

export type CompatibilityProjectionBinding = {
  tenantId: string;
  catalogProductId: string;
  revisionId: string;
  revisionHash: string;
  packageId: string;
  internalCode?: string | null;
  operationKey: string;
};
