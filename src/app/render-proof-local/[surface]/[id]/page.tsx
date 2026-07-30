import type { ComponentProps } from 'react';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import DetailClient from '@/app/packages/[id]/DetailClient';
import { LandingClient } from '@/app/lp/[id]/LandingClient';
import { getSecret } from '@/lib/secret-registry';
import { mapTravelPackageToLandingData } from '@/lib/map-travel-package-to-lp';
import { buildCandidatePublicPackageForProof } from '@/lib/package-publication/repository';
import { isSafeImageSrc } from '@/lib/image-url';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type OfflineRenderFixture = {
  id: string;
  package: Record<string, unknown>;
  attractions: Array<Record<string, unknown>>;
  heroImageUrl: string | null;
};

type OfflineRenderFixtureFile = {
  fixtures?: OfflineRenderFixture[];
};

async function hasProofAccess(): Promise<boolean> {
  if (process.env.ENABLE_OFFLINE_RENDER_PROOF !== '1') return false;
  const supplied = (await headers()).get('x-yeosonam-render-proof')?.trim();
  const secret = getSecret('REVALIDATE_SECRET') || getSecret('ADMIN_API_TOKEN');
  return Boolean(supplied && secret && supplied === secret);
}

function proofNotFound(reason: string): never {
  console.warn(`[offline-render-proof] blocked: ${reason}`);
  notFound();
}

function fixtureFilePath(): string | null {
  const configured = process.env.HWP_OFFLINE_RENDER_FIXTURE_PATH?.trim();
  if (!configured) return null;
  const workspace = path.resolve(process.cwd());
  const candidate = path.resolve(workspace, configured);
  const relative = path.relative(workspace, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return candidate;
}

async function loadFixture(id: string): Promise<OfflineRenderFixture | null> {
  const filePath = fixtureFilePath();
  if (!filePath) return null;
  try {
    const parsed = JSON.parse((await readFile(filePath)).toString('utf8')) as OfflineRenderFixtureFile;
    return parsed.fixtures?.find(fixture => fixture.id === id) ?? null;
  } catch {
    return null;
  }
}

export default async function OfflineRenderProofPage({
  params,
}: {
  params: Promise<{ surface?: string; id?: string }>;
}) {
  if (!(await hasProofAccess())) proofNotFound('access_denied');
  const { surface = '', id = '' } = await params;
  if (surface !== 'packages' && surface !== 'lp') proofNotFound('unsupported_surface');
  const fixture = await loadFixture(id.trim());
  if (!fixture) proofNotFound('fixture_not_found');
  const proofCandidate = buildCandidatePublicPackageForProof(fixture.package);
  if (!proofCandidate) proofNotFound('candidate_snapshot_not_projectable');
  const proofPackage = proofCandidate.package;

  if (surface === 'lp') {
    const frozenHeroCandidates = [
      proofPackage.lp_hero_image_url,
      proofPackage.hero_image_url,
      ...(Array.isArray(proofPackage.thumbnail_urls) ? proofPackage.thumbnail_urls : []),
    ];
    const frozenHero = frozenHeroCandidates.find(
      (value): value is string => typeof value === 'string' && isSafeImageSrc(value),
    ) ?? null;
    const data = mapTravelPackageToLandingData(proofPackage, frozenHero);
    return <LandingClient initialData={data} initialNotices={[]} />;
  }

  type DetailProps = ComponentProps<typeof DetailClient>;
  return (
    <DetailClient
      initialPackage={proofPackage as unknown as DetailProps['initialPackage']}
      initialAttractions={fixture.attractions as unknown as DetailProps['initialAttractions']}
      packageId={fixture.id}
      initialNotices={[]}
      socialProof={{ bookings: 0, interest: 0 }}
    />
  );
}
