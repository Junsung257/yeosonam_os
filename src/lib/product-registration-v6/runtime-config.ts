export type ProductRegistrationV6RuntimeConfig = {
  authorityMode: 'legacy' | 'shadow' | 'kernel';
  workflowEnabled: boolean;
  shadowEnabled: boolean;
  publishEnabled: boolean;
  publicationFrozen: boolean;
  /**
   * Legacy observability field. V6.1 never lets an environment variable
   * authorize publication; a frozen release requires an exact, one-time DB
   * authorization for the revision/snapshot/proof/pointer tuple.
   */
  sourceProofAutoPublishEnabled: boolean;
};

function authorityMode(): ProductRegistrationV6RuntimeConfig['authorityMode'] {
  const configured = process.env.PRODUCT_REGISTRATION_AUTHORITY_MODE?.trim().toLowerCase();
  if (configured === 'legacy' || configured === 'shadow' || configured === 'kernel') return configured;
  // An unset deployment still runs the Kernel in non-publishing shadow mode.
  // Publication remains independently frozen and requires explicit kernel
  // authority, so analysis cannot silently fall back to a legacy writer.
  return 'shadow';
}

function enabled(name: string, defaultValue = false): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

export function getProductRegistrationV6RuntimeConfig(): ProductRegistrationV6RuntimeConfig {
  const mode = authorityMode();
  return {
    authorityMode: mode,
    workflowEnabled: mode !== 'legacy',
    shadowEnabled: enabled('PRODUCT_REGISTRATION_V6_SHADOW_ENABLED', true),
    publishEnabled: enabled('PRODUCT_REGISTRATION_V6_PUBLISH_ENABLED'),
    publicationFrozen: enabled('PRODUCT_REGISTRATION_PUBLICATION_FREEZE', true),
    // Deliberately ignore PRODUCT_REGISTRATION_SOURCE_PROOF_AUTO_PUBLISH.
    // Publication authority is a database record, never process configuration.
    sourceProofAutoPublishEnabled: false,
  };
}

/**
 * Source-proof mode is deliberately a *publish attempt* switch, not a
 * publication bypass.  It lets a Workflow reach the database CAS writer;
 * the writer still enforces authority mode, kill switches, immutable
 * lineage, verified claims and passed mobile proof for the exact source.
 */
export function productRegistrationV6SourceProofAutoPublishEnabled(): boolean { return false; }

export function productRegistrationV6PublicationBlocker(): string | null {
  const config = getProductRegistrationV6RuntimeConfig();
  if (config.publicationFrozen) return 'PUBLICATION_FREEZE_ACTIVE';
  if (config.authorityMode !== 'kernel') return 'REGISTRATION_KERNEL_AUTHORITY_DISABLED';
  if (!config.publishEnabled) return config.shadowEnabled
    ? 'V6_SHADOW_MODE_PUBLICATION_DISABLED'
    : 'V6_PUBLICATION_DISABLED';
  return null;
}

export function productRegistrationLegacyWriterBlocker(): string | null {
  return getProductRegistrationV6RuntimeConfig().authorityMode !== 'legacy'
    ? 'REGISTRATION_KERNEL_REQUIRES_SOURCE_OR_CORRECTION_REVISION'
    : null;
}
