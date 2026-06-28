import { describe, expect, it } from 'vitest';
import { getHITLInfo, getRegisteredActionCount, requiresHITL } from './hitl';

describe('Jarvis HITL registry', () => {
  it('requires approval for every high-risk mutating Jarvis tool added to MCP', () => {
    const mutatingTools = [
      'activate_policy',
      'update_package_field',
      'delete_package',
      'approve_content',
      'run_ad_optimization',
      'trigger_cron_job',
      'process_gdpr_request',
      'resolve_fraud_case',
      'toggle_integration',
      'update_system_config',
      'update_guest_names',
      'export_settlement_report',
      'create_rfq_proposal',
      'send_booking_guide',
      'generate_affiliate_link',
      'dismiss_alert',
    ];

    for (const tool of mutatingTools) {
      expect(requiresHITL(tool), tool).toBe(true);
      expect(getHITLInfo(tool)?.description).toBeTruthy();
    }
  });

  it('does not require approval for read-only or unknown tools', () => {
    expect(requiresHITL('search_packages')).toBe(false);
    expect(requiresHITL('get_os_health')).toBe(false);
    expect(requiresHITL('unknown_tool')).toBe(false);
  });

  it('is backed by a broad central registry', () => {
    expect(getRegisteredActionCount()).toBeGreaterThanOrEqual(30);
  });
});
