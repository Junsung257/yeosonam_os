import type { SupabaseClient } from '@supabase/supabase-js';

import { buildPublicPackageSnapshot } from './public-snapshot';
import { evaluatePublicSnapshotPublishGate, type PublicSnapshotGateInput } from './publish-gate';
import type { PublicPackageSnapshot } from './types';

type AnyRecord = Record<string, unknown>;

type SnapshotRow = {
  id: string;
  package_id: string;
  package_revision: number;
  snapshot_hash: string;
  snapshot_json: PublicPackageSnapshot | AnyRecord;
  card_projection: AnyRecord;
  lp_projection: AnyRecord;
  route_text_dump: string[];
  status: string;
  created_at: string;
};

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function snapshotPackage(row: SnapshotRow): AnyRecord | null {
  const snapshot = asRecord(row.snapshot_json);
  const pkg = asRecord(snapshot?.package);
  if (!pkg) return null;
  return {
    ...pkg,
    _public_snapshot: {
      id: row.id,
      package_id: row.package_id,
      package_revision: row.package_revision,
      snapshot_hash: row.snapshot_hash,
      status: row.status,
      created_at: row.created_at,
    },
  };
}

export async function fetchLatestPublicPackageSnapshot(
  supabase: SupabaseClient,
  packageId: string,
): Promise<{ row: SnapshotRow; package: AnyRecord } | null> {
  const { data, error } = await supabase
    .from('public_package_snapshots')
    .select('id, package_id, package_revision, snapshot_hash, snapshot_json, card_projection, lp_projection, route_text_dump, status, created_at')
    .eq('package_id', packageId)
    .in('status', ['approved', 'published'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  const pkg = snapshotPackage(data as SnapshotRow);
  return pkg ? { row: data as SnapshotRow, package: pkg } : null;
}

export async function createPublicPackageSnapshotAndDecision(
  supabase: SupabaseClient,
  pkg: AnyRecord,
  gateInput: Omit<PublicSnapshotGateInput, 'pkg' | 'publicSnapshotHash' | 'snapshotExists' | 'routeTextDump'> = {},
): Promise<{
  snapshot: PublicPackageSnapshot;
  snapshotHash: string;
  publicationState: string;
  publishable: boolean;
  blockers: unknown[];
}> {
  const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
  const packageId = String(pkg.id ?? snapshot.package_id);
  const packageRevision = Number(pkg.package_revision ?? snapshot.package_revision ?? 1);
  const gate = evaluatePublicSnapshotPublishGate({
    ...gateInput,
    pkg,
    publicSnapshotHash: snapshotHash,
    snapshotExists: true,
    routeTextDump: snapshot.route_text_dump,
  });
  const snapshotStatus = gate.publishable ? 'published' : 'blocked';

  const { data: inserted, error: insertError } = await supabase
    .from('public_package_snapshots')
    .upsert({
      package_id: packageId,
      package_revision: packageRevision,
      snapshot_hash: snapshotHash,
      snapshot_json: snapshot,
      card_projection: snapshot.card_projection,
      lp_projection: snapshot.lp_projection,
      route_text_dump: snapshot.route_text_dump,
      source_raw_text_hash: typeof pkg.raw_text_hash === 'string' ? pkg.raw_text_hash : null,
      audit_revision: typeof pkg.audit_checked_at === 'string' ? pkg.audit_checked_at : null,
      mobile_proof_revision: typeof gateInput.mobileProof?.proof?.checked_at === 'string'
        ? gateInput.mobileProof.proof.checked_at
        : null,
      app_build_id: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_BUILD_ID ?? null,
      status: snapshotStatus,
      published_at: gate.publishable ? new Date().toISOString() : null,
    }, { onConflict: 'package_id,snapshot_hash' })
    .select('id')
    .single();

  if (insertError) throw insertError;

  await supabase
    .from('package_publish_decisions')
    .insert({
      package_id: packageId,
      package_revision: packageRevision,
      public_snapshot_id: (inserted as { id?: string } | null)?.id ?? null,
      public_snapshot_hash: snapshotHash,
      publication_state: gate.publication_state,
      publishable: gate.publishable,
      hard_blockers: gate.hard_blockers,
      soft_warnings: gate.soft_warnings,
      required_actions: gate.required_actions,
      mobile_proof_ref: typeof gateInput.mobileProof?.proof?.checked_at === 'string'
        ? gateInput.mobileProof.proof.checked_at
        : null,
    });

  await supabase
    .from('travel_packages')
    .update({
      publication_state: gate.publication_state,
      package_revision: packageRevision,
    })
    .eq('id', packageId);

  return {
    snapshot,
    snapshotHash,
    publicationState: gate.publication_state,
    publishable: gate.publishable,
    blockers: gate.hard_blockers,
  };
}
