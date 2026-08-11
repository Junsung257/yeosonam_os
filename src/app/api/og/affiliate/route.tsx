/**
 * GET /api/og/affiliate?code={code}&pkg={packageId}
 *
 * 어필리에이터 + 여소남 Co-brand OG 이미지 동적 생성.
 * 카톡/페북/네이버 공유 시 미리보기로 노출되어 클릭률 향상.
 *
 * 사용:
 *   <meta property="og:image" content="/api/og/affiliate?code=ABC&pkg=xxx" />
 *   /r/{code}/{slug} 단축링크의 메타에서 자동 사용.
 *
 * 사양:
 *   - 1200×630 (Open Graph 표준)
 *   - 어필리에이터 이름 + 여소남 로고 + 상품 타이틀·가격
 *   - 공정위 "광고" 워터마크 우측 상단
 *   - Edge 런타임 — 빠른 응답
 */
import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';
import { getSecret } from '@/lib/secret-registry';

export const runtime = 'edge';

// 캐시: 동일 code+pkg 조합은 1시간 동안 같은 이미지 (CDN edge 캐시).
export const revalidate = 3600;

type RestPackageGateRow = {
  publication_state?: string | null;
  package_revision?: number | null;
};

type PublicSnapshotRestRow = {
  snapshot_hash?: string | null;
  snapshot_json?: Record<string, unknown> | null;
  card_projection?: Record<string, unknown> | null;
};

type RestV4JobRow = {
  id?: string | null;
  source_document_id?: string | null;
  extraction_id?: string | null;
  v4_stage?: string | null;
  v4_stage_state?: Record<string, unknown> | null;
  v4_canonical_normalization_id?: string | null;
};

type RestV4NormalizationRow = {
  id?: string | null;
  job_id?: string | null;
  source_document_id?: string | null;
  extraction_id?: string | null;
  canonical_payload?: { sections?: unknown[] } | null;
  status?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function isPublicPackageGateRow(row: RestPackageGateRow | null | undefined): row is RestPackageGateRow {
  return row?.publication_state === 'approved' || row?.publication_state === 'published';
}

async function isV4PublicationReadyViaRest(
  supabaseUrl: string,
  headers: Record<string, string>,
  packageId: string,
): Promise<boolean> {
  const draftRes = await fetch(
    `${supabaseUrl}/rest/v1/product_registration_drafts?package_id=eq.${encodeURIComponent(packageId)}&upload_job_id=not.is.null&select=upload_job_id&order=created_at.desc&limit=1`,
    { headers, next: { revalidate: 60 } },
  );
  if (!draftRes.ok) return false;
  const drafts = (await draftRes.json()) as Array<{ upload_job_id?: string | null }>;
  let job: RestV4JobRow | null = null;

  if (drafts?.[0]?.upload_job_id) {
    const jobRes = await fetch(
      `${supabaseUrl}/rest/v1/upload_jobs?id=eq.${encodeURIComponent(String(drafts[0].upload_job_id))}&select=id,source_document_id,extraction_id,v4_stage,v4_stage_state,v4_canonical_normalization_id&limit=1`,
      { headers, next: { revalidate: 60 } },
    );
    if (!jobRes.ok) return false;
    const jobs = (await jobRes.json()) as RestV4JobRow[];
    job = jobs?.[0] ?? null;
  } else {
    // The V4 sidecar draft is asynchronous. Search the bounded job window for
    // a package id stored in the lifecycle state before treating it as legacy.
    const jobsRes = await fetch(
      `${supabaseUrl}/rest/v1/upload_jobs?source_document_id=not.is.null&v4_stage=in.(normalized,verified,proofed,published,needs_review,failed)&select=id,source_document_id,extraction_id,v4_stage,v4_stage_state,v4_canonical_normalization_id&order=updated_at.desc&limit=200`,
      { headers, next: { revalidate: 60 } },
    );
    if (!jobsRes.ok) return false;
    const jobs = (await jobsRes.json()) as RestV4JobRow[];
    job = jobs.find((candidate) => {
      const state = candidate.v4_stage_state ?? {};
      const packageIds = Array.isArray(state.packageIds) ? state.packageIds : [];
      return state.packageId === packageId || packageIds.includes(packageId);
    }) ?? null;
  }

  if (!job) return true;
  const normalizationId = typeof job.v4_canonical_normalization_id === 'string'
    ? job.v4_canonical_normalization_id
    : null;
  if (!job.id || !job.source_document_id || !job.extraction_id || !normalizationId
    || !['normalized', 'verified', 'proofed', 'published'].includes(job.v4_stage ?? '')) {
    return false;
  }

  const normalizationRes = await fetch(
    `${supabaseUrl}/rest/v1/product_registration_v4_normalizations?id=eq.${encodeURIComponent(normalizationId)}&job_id=eq.${encodeURIComponent(job.id)}&source_document_id=eq.${encodeURIComponent(job.source_document_id)}&extraction_id=eq.${encodeURIComponent(job.extraction_id)}&status=eq.complete&select=id,job_id,source_document_id,extraction_id,canonical_payload&limit=1`,
    { headers, next: { revalidate: 60 } },
  );
  if (!normalizationRes.ok) return false;
  const normalizations = (await normalizationRes.json()) as RestV4NormalizationRow[];
  return Array.isArray(normalizations?.[0]?.canonical_payload?.sections)
    && normalizations[0].canonical_payload!.sections!.length > 0;
}

function publicProductFromSnapshot(row: PublicSnapshotRestRow | null | undefined): {
  title: string;
  destination: string;
  price: number | null;
} | null {
  const snapshot = asRecord(row?.snapshot_json);
  const card = asRecord(row?.card_projection);
  const pkg = asRecord(snapshot?.package);
  const destinations = Array.isArray(snapshot?.destinations) ? snapshot.destinations : [];

  const title =
    asNonEmptyString(card?.title) ||
    asNonEmptyString(snapshot?.public_title) ||
    asNonEmptyString(pkg?.title) ||
    asNonEmptyString(pkg?.display_title);

  if (!title) return null;

  return {
    title,
    destination:
      asNonEmptyString(card?.destination) ||
      asNonEmptyString(destinations[0]) ||
      asNonEmptyString(pkg?.destination) ||
      '',
    price: asNumber(card?.price ?? pkg?.price),
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = normalizeAffiliateReferralCode(searchParams.get('code') || 'PARTNER') || 'PARTNER';
  const pkgId = searchParams.get('pkg');

  // 상품 / 어필리에이터 메타 페치 (서버측 supabase rest)
  let productTitle = '여소남 추천 여행';
  let productDestination = '';
  let productPrice: number | null = null;
  let observedSnapshotHash: string | null = null;
  let affiliateName = '여소남 파트너';

  try {
    const supabaseUrl = getSecret('NEXT_PUBLIC_SUPABASE_URL');
    const restKey =
      getSecret('SUPABASE_SERVICE_ROLE_KEY') || getSecret('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    if (supabaseUrl && restKey) {
      const headers = { apikey: restKey, Authorization: `Bearer ${restKey}` };
      // 어필리에이터
      const affRes = await fetch(
        `${supabaseUrl}/rest/v1/affiliates?referral_code=eq.${encodeURIComponent(code)}&select=name&limit=1`,
        { headers, next: { revalidate: 600 } },
      );
      const affs = (await affRes.json()) as Array<{ name: string }>;
      if (affs?.[0]?.name) affiliateName = affs[0].name;

      // 상품: 공개 상태/리비전만 원본 테이블에서 확인하고, 고객 문구는 public snapshot에서만 읽는다.
      if (pkgId) {
        const pkgGateRes = await fetch(
          `${supabaseUrl}/rest/v1/travel_packages?id=eq.${encodeURIComponent(pkgId)}&select=publication_state,package_revision&publication_state=in.(approved,published)&limit=1`,
          { headers, next: { revalidate: 600 } },
        );
        const pkgGateRows = (await pkgGateRes.json()) as RestPackageGateRow[];
        const gateRow = pkgGateRows?.[0];
        const revision = Number(gateRow?.package_revision ?? 1);

        const v4Ready = await isV4PublicationReadyViaRest(supabaseUrl, headers, pkgId);
        if (v4Ready && isPublicPackageGateRow(gateRow) && Number.isFinite(revision) && revision > 0) {
          const snapshotRes = await fetch(
            `${supabaseUrl}/rest/v1/public_package_snapshots?package_id=eq.${encodeURIComponent(pkgId)}&package_revision=eq.${revision}&status=in.(approved,published)&select=snapshot_hash,snapshot_json,card_projection&order=created_at.desc&limit=1`,
            { headers, next: { revalidate: 600 } },
          );
          const snapshotRows = (await snapshotRes.json()) as PublicSnapshotRestRow[];
          const snapshotRow = snapshotRows?.[0];
          const publicProduct = publicProductFromSnapshot(snapshotRow);
          if (publicProduct) {
            productTitle = publicProduct.title;
            productDestination = publicProduct.destination;
            productPrice = publicProduct.price;
            observedSnapshotHash = typeof snapshotRow?.snapshot_hash === 'string'
              && /^[0-9a-f]{64}$/i.test(snapshotRow.snapshot_hash)
              ? snapshotRow.snapshot_hash.toLowerCase()
              : null;
          }
        }
      }
    }
  } catch { /* fallback to defaults */ }

  const response = new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(135deg, #001f3f 0%, #003366 60%, #0066cc 100%)',
          color: 'white',
          padding: '60px 70px',
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
      >
        {/* 광고 표시 (공정위) */}
        <div
          style={{
            position: 'absolute',
            top: 30,
            right: 30,
            background: 'rgba(255, 215, 0, 0.95)',
            color: '#1a1a1a',
            padding: '8px 18px',
            borderRadius: 999,
            fontSize: 18,
            fontWeight: 700,
            display: 'flex',
          }}
        >
          광고 · 제휴 콘텐츠
        </div>

        {/* 발행자 라인 (Co-brand) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 22, opacity: 0.85 }}>
          <span>{affiliateName}</span>
          <span style={{ opacity: 0.5 }}>×</span>
          <span style={{ fontWeight: 800, color: '#FFD700' }}>여소남</span>
        </div>

        {/* 상품 타이틀 */}
        <div
          style={{
            marginTop: 32,
            fontSize: 56,
            fontWeight: 900,
            lineHeight: 1.15,
            display: 'flex',
            flexWrap: 'wrap',
            maxWidth: 1000,
          }}
        >
          {productTitle.length > 60 ? productTitle.slice(0, 58) + '…' : productTitle}
        </div>

        {/* 메타 */}
        <div style={{ marginTop: 24, display: 'flex', gap: 24, fontSize: 28, opacity: 0.95 }}>
          {productDestination && (
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ opacity: 0.6 }}>📍</span>
              <span>{productDestination}</span>
            </div>
          )}
          {productPrice && (
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ opacity: 0.6 }}>💰</span>
              <span>₩{productPrice.toLocaleString()}부터</span>
            </div>
          )}
        </div>

        {/* CTA */}
        <div
          style={{
            marginTop: 'auto',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
          }}
        >
          <div
            style={{
              fontSize: 24,
              background: 'white',
              color: '#001f3f',
              padding: '14px 32px',
              borderRadius: 999,
              fontWeight: 800,
              display: 'flex',
            }}
          >
            👉 자세히 보기 / 상담하기
          </div>
          <div style={{ fontSize: 16, opacity: 0.6, display: 'flex' }}>
            yeosonam.co.kr/r/{code}
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
  if (observedSnapshotHash) {
    response.headers.set('x-product-registration-v5-snapshot-hash', observedSnapshotHash);
  }
  return response;
}
