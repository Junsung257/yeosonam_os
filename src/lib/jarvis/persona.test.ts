import { describe, expect, it } from 'vitest';
import { filterAllowedToolsByProfile, isAgentAllowedByProfile } from './persona';

describe('tenant Jarvis persona productization rules', () => {
  it('allows customer concierge when runtime agent is products', () => {
    expect(isAgentAllowedByProfile(
      { allowed_agents: ['concierge'] },
      'products',
      { tenantId: 'tenant-1', userRole: 'customer', surface: 'customer' },
    )).toBe(true);
  });

  it('does not treat concierge alias as products on admin surface', () => {
    expect(isAgentAllowedByProfile(
      { allowed_agents: ['concierge'] },
      'products',
      { tenantId: 'tenant-1', userRole: 'tenant_admin', surface: 'admin' },
    )).toBe(false);
  });

  it('defaults to allow when tenant has no explicit agent list', () => {
    expect(isAgentAllowedByProfile(
      { allowed_agents: null },
      'finance',
      { tenantId: 'tenant-1', userRole: 'tenant_admin', surface: 'admin' },
    )).toBe(true);
  });

  it('filters LLM tool catalog by tenant allowed_tools', () => {
    const tools = [
      { name: 'knowledge_search' },
      { name: 'recommend_best_packages' },
      { name: 'create_booking' },
    ];

    expect(filterAllowedToolsByProfile(tools, {
      allowed_tools: ['knowledge_search', 'recommend_best_packages'],
    })).toEqual([
      { name: 'knowledge_search' },
      { name: 'recommend_best_packages' },
    ]);
  });
});
