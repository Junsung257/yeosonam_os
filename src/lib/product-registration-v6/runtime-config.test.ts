import { afterEach, describe, expect, it } from 'vitest';

import {
  getProductRegistrationV6RuntimeConfig,
  productRegistrationLegacyWriterBlocker,
  productRegistrationV6PublicationBlocker,
  productRegistrationV6SourceProofAutoPublishEnabled,
} from './runtime-config';

const ENV_NAMES = [
  'PRODUCT_REGISTRATION_AUTHORITY_MODE',
  'PRODUCT_REGISTRATION_V6_WORKFLOW_ENABLED',
  'PRODUCT_REGISTRATION_V6_SHADOW_ENABLED',
  'PRODUCT_REGISTRATION_V6_PUBLISH_ENABLED',
  'PRODUCT_REGISTRATION_PUBLICATION_FREEZE',
  'PRODUCT_REGISTRATION_SOURCE_PROOF_AUTO_PUBLISH',
] as const;

const originalEnv = Object.fromEntries(
  ENV_NAMES.map((name) => [name, process.env[name]]),
);

afterEach(() => {
  for (const name of ENV_NAMES) {
    const value = originalEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('product registration V6 runtime config', () => {
  it('enables source-proof publication by default while keeping broad publication frozen', () => {
    for (const name of ENV_NAMES) delete process.env[name];

    expect(getProductRegistrationV6RuntimeConfig()).toEqual({
      authorityMode: 'shadow',
      workflowEnabled: true,
      shadowEnabled: true,
      publishEnabled: false,
      publicationFrozen: true,
      sourceProofAutoPublishEnabled: true,
    });
    expect(productRegistrationV6PublicationBlocker()).toBe('PUBLICATION_FREEZE_ACTIVE');
  });

  it('publishes only when publish is enabled and freeze is explicitly disabled', () => {
    process.env.PRODUCT_REGISTRATION_AUTHORITY_MODE = 'kernel';
    process.env.PRODUCT_REGISTRATION_V6_PUBLISH_ENABLED = '1';
    process.env.PRODUCT_REGISTRATION_PUBLICATION_FREEZE = '0';

    expect(productRegistrationV6PublicationBlocker()).toBeNull();
  });

  it('allows only the source-proof publish attempt in a frozen shadow deployment', () => {
    process.env.PRODUCT_REGISTRATION_AUTHORITY_MODE = 'shadow';
    process.env.PRODUCT_REGISTRATION_SOURCE_PROOF_AUTO_PUBLISH = '1';

    expect(productRegistrationV6SourceProofAutoPublishEnabled()).toBe(true);
    // The normal blocker remains intact for callers that do not opt into the
    // source-proof attempt path.
    expect(productRegistrationV6PublicationBlocker()).toBe('PUBLICATION_FREEZE_ACTIVE');
  });

  it('never enables source-proof publication in retired legacy authority mode', () => {
    process.env.PRODUCT_REGISTRATION_AUTHORITY_MODE = 'legacy';
    process.env.PRODUCT_REGISTRATION_SOURCE_PROOF_AUTO_PUBLISH = '1';

    expect(productRegistrationV6SourceProofAutoPublishEnabled()).toBe(false);
  });

  it('uses the durable workflow for shadow and kernel authority modes', () => {
    process.env.PRODUCT_REGISTRATION_AUTHORITY_MODE = 'shadow';
    expect(getProductRegistrationV6RuntimeConfig().workflowEnabled).toBe(true);
    expect(productRegistrationV6PublicationBlocker()).toBe('PUBLICATION_FREEZE_ACTIVE');

    process.env.PRODUCT_REGISTRATION_AUTHORITY_MODE = 'kernel';
    expect(getProductRegistrationV6RuntimeConfig().workflowEnabled).toBe(true);
  });

  it('never infers kernel authority from the retired workflow flag', () => {
    delete process.env.PRODUCT_REGISTRATION_AUTHORITY_MODE;
    process.env.PRODUCT_REGISTRATION_V6_WORKFLOW_ENABLED = '1';

    expect(getProductRegistrationV6RuntimeConfig().authorityMode).toBe('shadow');
    expect(getProductRegistrationV6RuntimeConfig().workflowEnabled).toBe(true);
  });

  it('retires mutable legacy endpoints whenever the Kernel workflow owns intake', () => {
    process.env.PRODUCT_REGISTRATION_AUTHORITY_MODE = 'shadow';
    expect(productRegistrationLegacyWriterBlocker()).toBe('REGISTRATION_KERNEL_REQUIRES_SOURCE_OR_CORRECTION_REVISION');

    process.env.PRODUCT_REGISTRATION_AUTHORITY_MODE = 'kernel';
    expect(productRegistrationLegacyWriterBlocker()).toBe('REGISTRATION_KERNEL_REQUIRES_SOURCE_OR_CORRECTION_REVISION');
  });
});
