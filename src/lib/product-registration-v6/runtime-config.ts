export type ProductRegistrationV6RuntimeConfig = {
  authorityMode: 'legacy' | 'shadow' | 'kernel';
  workflowEnabled: boolean;
  shadowEnabled: boolean;
  publishEnabled: boolean;
  publicationFrozen: boolean;
};

function authorityMode(): ProductRegistrationV6RuntimeConfig['authorityMode'] {
  const configured = process.env.PRODUCT_REGISTRATION_AUTHORITY_MODE?.trim().toLowerCase();
  if (configured === 'legacy' || configured === 'shadow' || configured === 'kernel') return configured;
  return enabled('PRODUCT_REGISTRATION_V6_WORKFLOW_ENABLED') ? 'kernel' : 'legacy';
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
    workflowEnabled: mode !== 'legacy' || enabled('PRODUCT_REGISTRATION_V6_WORKFLOW_ENABLED'),
    shadowEnabled: enabled('PRODUCT_REGISTRATION_V6_SHADOW_ENABLED', true),
    publishEnabled: enabled('PRODUCT_REGISTRATION_V6_PUBLISH_ENABLED'),
    publicationFrozen: enabled('PRODUCT_REGISTRATION_PUBLICATION_FREEZE', true),
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
  return getProductRegistrationV6RuntimeConfig().authorityMode === 'kernel'
    ? 'REGISTRATION_KERNEL_REQUIRES_SOURCE_OR_CORRECTION_REVISION'
    : null;
}
