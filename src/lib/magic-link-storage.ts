/**
 * 매직링크 게스트 업로드 스토리지 헬퍼.
 *
 * 버킷: `customer-uploads` (private). 직접 URL 접근 불가 — admin 이 signed URL 발급 후 열람.
 * 경로 규칙: `<actionType>/<tokenId>/<random>.<ext>` — token 폐기 시 디렉터리 단위 삭제 가능.
 */

import { randomBytes } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import type { MagicActionType } from '@/lib/magic-link';

const BUCKET = 'customer-uploads';
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);
const MAX_BYTES = 10 * 1024 * 1024;

export interface UploadResult {
  path: string;       // 버킷 내부 경로 (signed URL 발급용)
  size: number;
  contentType: string;
}

export async function uploadGuestFile(
  actionType: MagicActionType,
  tokenId: string,
  file: File,
): Promise<{ ok: true; result: UploadResult } | { ok: false; reason: string }> {
  if (!ALLOWED_MIME.has(file.type)) {
    return { ok: false, reason: `unsupported_mime:${file.type}` };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, reason: `too_large:${file.size}` };
  }
  if (file.size === 0) {
    return { ok: false, reason: 'empty_file' };
  }

  const ext = mimeToExt(file.type);
  const rand = randomBytes(8).toString('base64url');
  const path = `${actionType}/${tokenId}/${rand}.${ext}`;

  const buf = Buffer.from(await file.arrayBuffer());

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buf, {
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    return { ok: false, reason: `storage_error:${error.message}` };
  }

  return {
    ok: true,
    result: { path, size: file.size, contentType: file.type },
  };
}

/** 어드민 검토용 signed URL 발급 (기본 1시간) */
export async function createGuestFileSignedUrl(
  path: string,
  expiresInSec = 3600,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSec);
  if (error || !data) return null;
  return data.signedUrl;
}

/** 토큰 폐기 시 그 토큰의 모든 업로드 파일 삭제 */
export async function deleteGuestFilesForToken(
  actionType: MagicActionType,
  tokenId: string,
): Promise<{ deletedCount: number }> {
  const prefix = `${actionType}/${tokenId}/`;
  const { data: list } = await supabaseAdmin.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (!list || list.length === 0) return { deletedCount: 0 };
  const paths = list.map((f: { name: string }) => `${prefix}${f.name}`);
  await supabaseAdmin.storage.from(BUCKET).remove(paths);
  return { deletedCount: paths.length };
}

function mimeToExt(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/heic':
      return 'heic';
    case 'application/pdf':
      return 'pdf';
    default:
      return 'bin';
  }
}
