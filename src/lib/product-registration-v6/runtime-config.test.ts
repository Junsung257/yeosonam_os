import { afterEach, describe, expect, it } from 'vitest';

import {
  getProductRegistrationV6RuntimeConfig,
  productRegistrationV6PublicationBlocker,
} from './runtime-config';

const ENV_NAMES = [
  'PRODUCT_REGISTRATION_V6_WORKFLOW_ENABLED',
  'PRODUCT_REGISTRATION_V6_SHADOW_ENABLED',
  'PRODUCT_REGISTRATION_V6_PUBLISH_ENABLED',
  'PRODUCT_REGISTRATION_PUBLICATION_FREEZE',
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
  it('fails closed when no publication flags are configured', () => {
    for (const name of ENV_NAMES) delete process.env[name];

    expect(getProductRegistrationV6RuntimeConfig()).toEqual({
      workflowEnabled: false,
      shadowEnabled: true,
      publishEnabled: false,
      publicationFrozen: true,
    });
    expect(productRegistrationV6PublicationBlocker()).toBe('PUBLICATION_FREEZE_ACTIVE');
  });

  it('publishes only when publish is enabled and freeze is explicitly disabled', () => {
    process.env.PRODUCT_REGISTRATION_V6_PUBLISH_ENABLED = '1';
    process.env.PRODUCT_REGISTRATION_PUBLICATION_FREEZE = '0';

    expect(productRegistrationV6PublicationBlocker()).toBeNull();
  });
});
