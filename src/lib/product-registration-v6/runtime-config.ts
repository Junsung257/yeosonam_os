export type ProductRegistrationV6RuntimeConfig = {
  workflowEnabled: boolean;
  shadowEnabled: boolean;
  publishEnabled: boolean;
  publicationFrozen: boolean;
};

function enabled(name: string, defaultValue = false): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

export function getProductRegistrationV6RuntimeConfig(): ProductRegistrationV6RuntimeConfig {
  return {
    workflowEnabled: enabled('PRODUCT_REGISTRATION_V6_WORKFLOW_ENABLED'),
    shadowEnabled: enabled('PRODUCT_REGISTRATION_V6_SHADOW_ENABLED', true),
    publishEnabled: enabled('PRODUCT_REGISTRATION_V6_PUBLISH_ENABLED'),
    publicationFrozen: enabled('PRODUCT_REGISTRATION_PUBLICATION_FREEZE', true),
  };
}

export function productRegistrationV6PublicationBlocker(): string | null {
  const config = getProductRegistrationV6RuntimeConfig();
  if (config.publicationFrozen) return 'PUBLICATION_FREEZE_ACTIVE';
  if (!config.publishEnabled) return config.shadowEnabled
    ? 'V6_SHADOW_MODE_PUBLICATION_DISABLED'
    : 'V6_PUBLICATION_DISABLED';
  return null;
}
