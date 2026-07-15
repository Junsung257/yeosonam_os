import { createHash } from 'node:crypto';

export type ProofInput = {
  publicSnapshotHash: string;
  sourceEvidenceDigest: string;
  renderContractHash: string;
  assetManifestHash: string;
  routeConfigHash: string;
  viewportProfileVersion: string;
  locale: string;
  featureFlagDigest: string;
};

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashAssetManifest(urls: string[]): string {
  return sha256([...new Set(urls.map(url => url.trim()).filter(Boolean))].sort().join('\n'));
}

export function buildProofInputHash(input: ProofInput): string {
  return sha256(JSON.stringify({
    public_snapshot_hash: input.publicSnapshotHash,
    source_evidence_digest: input.sourceEvidenceDigest,
    render_contract_hash: input.renderContractHash,
    asset_manifest_hash: input.assetManifestHash,
    route_config_hash: input.routeConfigHash,
    viewport_profile_version: input.viewportProfileVersion,
    locale: input.locale,
    feature_flag_digest: input.featureFlagDigest,
  }));
}

export function conservativeRenderContractHash(appBuildId: string | null | undefined): string {
  return sha256(`app-build:${appBuildId?.trim() || 'unknown'}`);
}

export function routeConfigHash(routes: string[], copyTemplateVersion: string): string {
  return sha256(`${[...routes].sort().join('|')}|${copyTemplateVersion}`);
}

export function buildCustomerPackageMobileProofInputHash(input: {
  publicSnapshotHash: string;
  sourceEvidenceDigest: string;
  assetUrls: string[];
  appBuildId?: string | null;
}): string {
  return buildProofInputHash({
    publicSnapshotHash: input.publicSnapshotHash,
    sourceEvidenceDigest: input.sourceEvidenceDigest,
    renderContractHash: conservativeRenderContractHash(input.appBuildId),
    assetManifestHash: hashAssetManifest(input.assetUrls),
    routeConfigHash: routeConfigHash(['packages', 'lp'], 'customer-copy-v1'),
    viewportProfileVersion: 'mobile-v1',
    locale: 'ko-KR',
    featureFlagDigest: sha256('customer-package-default-flags-v1'),
  });
}
