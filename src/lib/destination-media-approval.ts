export type DestinationMediaApprovalCandidate = {
  hero_image_url?: string | null;
  hero_image_provider?: string | null;
  hero_image_pexels_id?: number | null;
  hero_image_source_page_url?: string | null;
  hero_image_source_file_title?: string | null;
  hero_image_license?: string | null;
  hero_image_license_url?: string | null;
  hero_photographer?: string | null;
};

function present(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function destinationMediaApprovalMissingEvidence(
  candidate: DestinationMediaApprovalCandidate | null | undefined,
): string[] {
  if (!candidate) return ['후보 정보'];

  const missing: string[] = [];
  if (!present(candidate.hero_image_url)) missing.push('저장 이미지');
  if (!present(candidate.hero_image_provider)) missing.push('공급자');
  if (!present(candidate.hero_image_source_page_url)) missing.push('원본 페이지');
  if (!present(candidate.hero_photographer)) missing.push('저작자·권리자');

  if (candidate.hero_image_provider === 'pexels' && !candidate.hero_image_pexels_id) {
    missing.push('Pexels 자산 ID');
  }
  if (candidate.hero_image_provider === 'wikimedia_commons') {
    if (!present(candidate.hero_image_source_file_title)) missing.push('원본 파일명');
    if (!present(candidate.hero_image_license)) missing.push('라이선스');
    if (!present(candidate.hero_image_license_url)) missing.push('라이선스 원문');
  }

  if (
    candidate.hero_image_provider
    && !['pexels', 'wikimedia_commons', 'owner_upload', 'supplier_official']
      .includes(candidate.hero_image_provider)
  ) {
    missing.push('허용된 공급자');
  }

  return missing;
}

export function isDestinationMediaApprovalReady(
  candidate: DestinationMediaApprovalCandidate | null | undefined,
): boolean {
  return destinationMediaApprovalMissingEvidence(candidate).length === 0;
}
