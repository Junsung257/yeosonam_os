import { describe, expect, it } from 'vitest';
import {
  buildActionDecisionPacket,
  dryRunAction,
  getActionRegistryEntry,
  requiresActionApproval,
} from './agent-action-registry';

describe('agent action registry autopilot decisions', () => {
  it('rejects unregistered actions before execution', () => {
    const packet = buildActionDecisionPacket({
      actionType: 'wire_money_without_registry',
      payload: { amount: 1000000 },
      summary: 'Unknown money action',
    });

    expect(packet.recommendation).toBe('reject');
    expect(packet.riskLevel).toBe('critical');
    expect(packet.dryRun.ok).toBe(false);
    expect(packet.dryRun.blockers[0]).toContain('No registry entry');
  });

  it('blocks registered actions when required payload evidence is missing', () => {
    const dryRun = dryRunAction('match_payment', { transaction_id: 'txn_1' });

    expect(dryRun.ok).toBe(false);
    expect(dryRun.riskLevel).toBe('critical');
    expect(dryRun.blockers).toContain('Payload includes booking_id: missing');
  });

  it('does not recommend one-click RFQ submission without executable proposal fields', () => {
    const packet = buildActionDecisionPacket({
      actionType: 'submit_rfq_proposal',
      payload: { rfq_id: 'rfq_1', proposal_text: 'Looks good.' },
      summary: 'Incomplete RFQ proposal',
    });

    expect(packet.recommendation).toBe('reject');
    expect(packet.dryRun.blockers).toEqual(expect.arrayContaining([
      'Payload includes bid_id: missing',
      'Payload includes tenant_id: missing',
      'Payload includes total_cost: missing',
      'Payload includes total_selling_price: missing',
      'Payload includes checklist: missing',
    ]));
  });

  it('recommends approval when dry-run and evidence gates pass', () => {
    const packet = buildActionDecisionPacket({
      actionType: 'match_payment',
      payload: {
        transaction_id: 'txn_1',
        booking_id: 'booking_1',
        reason: 'Bank transfer amount and depositor matched.',
      },
      summary: 'Match payment to booking',
    });

    expect(packet.recommendation).toBe('approve');
    expect(packet.requiresApproval).toBe(true);
    expect(packet.confidence).toBeGreaterThanOrEqual(0.9);
    expect(packet.evidence.map((item) => item.label)).toEqual(expect.arrayContaining([
      'transaction_id',
      'booking_id',
      'reason',
      'registry_required_evidence',
    ]));
  });

  it('prefers exact Jarvis tool registry entries over legacy aliases', () => {
    expect(getActionRegistryEntry('run_ad_optimization')?.actionType).toBe('run_ad_optimization');
    expect(getActionRegistryEntry('export_settlement_report')?.actionType).toBe('export_settlement_report');
    expect(requiresActionApproval('run_ad_optimization')).toBe(true);
    expect(requiresActionApproval('export_settlement_report')).toBe(true);
  });
});
