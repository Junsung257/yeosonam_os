export type ProductRegistrationV6RuntimeConfig = {
  authorityMode: 'legacy' | 'shadow' | 'kernel';
  workflowEnabled: boolean;
  shadowEnabled: boolean;
  publishEnabled: boolean;
  publicationFrozen: boolean;
  analysisRecoveryPreviewEnabled: boolean;
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
    analysisRecoveryPreviewEnabled: enabled('PRODUCT_REGISTRATION_V6_ANALYSIS_RECOVERY_PREVIEW_ENABLED'),
  };
}

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
