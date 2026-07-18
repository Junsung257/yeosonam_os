import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
const migrationName = fs.readdirSync(migrationsDir).find((name) => (
  name.endsWith('_tenant_portal_memberships_rls.sql')
));
if (!migrationName) throw new Error('tenant portal membership migration is missing');
const migrationPath = path.join(migrationsDir, migrationName);
const phaseCProposalPath = path.join(
  process.cwd(),
  'docs',
  'specs',
  '20260719-tenant-portal-auth-p0',
  'phase-c-rls-hardening-proposal.sql',
);

describe('tenant portal RLS migration contract', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const phaseCProposal = fs.readFileSync(phaseCProposalPath, 'utf8');

  it('creates a canonical auth user to tenant membership table with RLS', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.tenant_memberships');
    expect(sql).toContain('user_id uuid NOT NULL REFERENCES auth.users(id)');
    expect(sql).toContain('tenant_id uuid NOT NULL REFERENCES public.tenants(id)');
    expect(sql).toContain('ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('user_id = (SELECT auth.uid())');
    expect(sql).toContain('AND is_active');
  });

  it.each([
    'tenants',
    'travel_packages',
    'inventory_blocks',
    'api_orders',
    'group_rfqs',
    'rfq_bids',
    'rfq_proposals',
    'rfq_messages',
  ])('defers the broad authenticated_access replacement for %s to Phase C', (table) => {
    const dropPolicy = `DROP POLICY IF EXISTS authenticated_access ON public.${table};`;
    expect(sql).not.toContain(dropPolicy);
    expect(phaseCProposal).toContain(dropPolicy);
  });

  it('keeps existing tenant/RFQ table policy changes out of executable migrations', () => {
    expect(sql).not.toContain('ALTER TABLE public.group_rfqs ENABLE ROW LEVEL SECURITY');
    expect(sql).not.toContain('ALTER TABLE public.rfq_messages ENABLE ROW LEVEL SECURITY');
    expect(sql).not.toContain('CREATE POLICY tenant_members_manage_rfq_bids');
    expect(sql).not.toContain('CREATE POLICY tenant_members_manage_rfq_proposals');

    expect(phaseCProposal).toContain('ALTER TABLE public.group_rfqs ENABLE ROW LEVEL SECURITY');
    expect(phaseCProposal).toContain('ALTER TABLE public.rfq_messages ENABLE ROW LEVEL SECURITY');
    expect(phaseCProposal).toContain('CREATE POLICY tenant_members_manage_rfq_bids');
    expect(phaseCProposal).toContain('membership.tenant_id = rfq_bids.tenant_id');
    expect(phaseCProposal).toContain('CREATE POLICY tenant_members_manage_rfq_proposals');
    expect(phaseCProposal).toContain('membership.tenant_id = rfq_proposals.tenant_id');
    expect(phaseCProposal).not.toMatch(/CREATE POLICY tenant_members_[^\n]*group_rfqs/);
    expect(phaseCProposal).not.toMatch(/CREATE POLICY tenant_members_[^\n]*rfq_messages/);
  });

  it('requires an active tenant as well as an active membership in Phase C', () => {
    expect(phaseCProposal).toContain("tenants.status = 'active'");
    expect(phaseCProposal).toContain('JOIN public.tenants authorized_tenant');
    expect(phaseCProposal).toContain("authorized_tenant.status = 'active'");
  });

  it('revokes the caller-controlled Jarvis tenant context from untrusted roles', () => {
    expect(sql).toContain("to_regprocedure('public.set_jarvis_request_context(uuid,text,uuid)')");
    expect(sql).toContain('FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('TO service_role;');
    expect(sql).not.toContain('DROP POLICY IF EXISTS jarvis_v2_tenant_or_shared');
  });
});
