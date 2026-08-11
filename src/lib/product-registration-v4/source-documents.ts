import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { PRODUCT_REGISTRATION_V4_MAX_BYTES, type ProductSourceType, type SourceDocumentRecord } from './types';
import { PLATFORM_PRODUCT_REGISTRATION_TENANT_ID } from '@/lib/product-registration-authority/types';

export const PRODUCT_SOURCE_BUCKET = 'product-source-private';

const MIME_BY_TYPE: Record<ProductSourceType, string[]> = {
  text: ['text/plain', 'text/markdown'],
  pdf: ['application/pdf'],
  image: ['image/jpeg', 'image/png'],
  hwp: ['application/x-hwp', 'application/haansofthwp', 'application/vnd.hancom.hwp'],
  hwpx: ['application/vnd.hancom.hwpx', 'application/zip'],
};

export function hashSourceBytes(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function hasPrefix(buffer: Buffer, prefix: number[]): boolean {
  if (buffer.byteLength < prefix.length) return false;
  return prefix.every((value, index) => buffer[index] === value);
}

/** Cheap, deterministic preflight checks. They do not parse the document;
 * they only reject an extension/type mismatch before an untrusted parser runs. */
export function validateSourceBytes(input: {
  sourceType: ProductSourceType;
  buffer: Buffer;
}): string[] {
  if (input.buffer.byteLength === 0) return ['SOURCE_EMPTY'];
  const errors: string[] = [];
  const isOle = hasPrefix(input.buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const isZip = hasPrefix(input.buffer, [0x50, 0x4b, 0x03, 0x04])
    || hasPrefix(input.buffer, [0x50, 0x4b, 0x05, 0x06])
    || hasPrefix(input.buffer, [0x50, 0x4b, 0x07, 0x08]);
  if (input.sourceType === 'hwp' && !isOle) errors.push('HWP_OLE_SIGNATURE_REQUIRED');
  if (input.sourceType === 'hwpx' && !isZip) errors.push('HWPX_ZIP_SIGNATURE_REQUIRED');
  if (input.sourceType === 'pdf' && !hasPrefix(input.buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) errors.push('PDF_SIGNATURE_REQUIRED');
  if (input.sourceType === 'image') {
    const jpeg = hasPrefix(input.buffer, [0xff, 0xd8, 0xff]);
    const png = hasPrefix(input.buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!jpeg && !png) errors.push('IMAGE_SIGNATURE_REQUIRED');
  }
  return errors;
}

export function inferProductSourceType(filename: string, declaredMime?: string | null): ProductSourceType | null {
  const extension = filename.toLowerCase().split('.').pop();
  if (extension === 'txt' || extension === 'md') return 'text';
  if (extension === 'pdf' || MIME_BY_TYPE.pdf.includes(declaredMime ?? '')) return 'pdf';
  if (extension === 'jpg' || extension === 'jpeg' || extension === 'png' || MIME_BY_TYPE.image.includes(declaredMime ?? '')) return 'image';
  if (extension === 'hwp' || MIME_BY_TYPE.hwp.includes(declaredMime ?? '')) return 'hwp';
  if (extension === 'hwpx' || MIME_BY_TYPE.hwpx.includes(declaredMime ?? '')) return 'hwpx';
  return null;
}

export function validateSourceDocumentInput(input: {
  filename: string;
  byteSize: number;
  declaredMime?: string | null;
  sourceType: ProductSourceType;
}): string[] {
  const errors: string[] = [];
  if (!input.filename.trim()) errors.push('SOURCE_FILENAME_REQUIRED');
  if (input.byteSize <= 0) errors.push('SOURCE_EMPTY');
  if (input.byteSize > PRODUCT_REGISTRATION_V4_MAX_BYTES) errors.push('SOURCE_TOO_LARGE');
  if (!MIME_BY_TYPE[input.sourceType].some(mime => mime === (input.declaredMime ?? '') || !input.declaredMime)) {
    errors.push('SOURCE_MIME_MISMATCH');
  }
  return errors;
}

export async function findSourceDocumentByHash(
  supabase: SupabaseClient,
  tenantId: string,
  sha256: string,
  byteSize: number,
): Promise<SourceDocumentRecord | null> {
  const { data, error } = await supabase
    .from('product_source_documents')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('sha256', sha256)
    .eq('byte_size', byteSize)
    .maybeSingle();
  if (error) throw error;
  return (data as SourceDocumentRecord | null) ?? null;
}

export async function createSourceDocumentRecord(input: {
  supabase: SupabaseClient;
  filename: string;
  byteSize: number;
  declaredMime?: string | null;
  sourceType: ProductSourceType;
  sha256: string;
  storagePath: string;
  tenantId?: string | null;
  uploadedBy?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<SourceDocumentRecord> {
  const validationErrors = validateSourceDocumentInput(input);
  if (validationErrors.length > 0) {
    throw new Error(`SOURCE_DOCUMENT_INVALID:${validationErrors.join(',')}`);
  }

  const { data, error } = await input.supabase
    .from('product_source_documents')
    .insert({
      original_filename: input.filename,
      storage_bucket: PRODUCT_SOURCE_BUCKET,
      storage_path: input.storagePath,
      sha256: input.sha256,
      byte_size: input.byteSize,
      declared_mime: input.declaredMime ?? null,
      detected_mime: input.declaredMime ?? null,
      source_type: input.sourceType,
      status: 'stored',
      tenant_id: input.tenantId ?? PLATFORM_PRODUCT_REGISTRATION_TENANT_ID,
      uploaded_by: input.uploadedBy ?? null,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as SourceDocumentRecord;
}

export async function ensureSourceDocumentStored(input: {
  supabase: SupabaseClient;
  buffer: Buffer;
  filename: string;
  declaredMime?: string | null;
  sourceType: ProductSourceType;
  tenantId?: string | null;
  uploadedBy?: string | null;
  metadata?: Record<string, unknown>;
  requestKey?: string;
  sourceChannel?: string;
}): Promise<SourceDocumentRecord> {
  // Chromium/Edge commonly reports legacy HWP as octet-stream. The parser
  // signature check below remains authoritative, so store that ambiguous
  // MIME as null instead of rejecting a valid HWP solely on browser metadata.
  const declaredMime = input.declaredMime === 'application/octet-stream'
    && (input.sourceType === 'hwp' || input.sourceType === 'hwpx')
    ? null
    : input.declaredMime;
  const validationErrors = [
    ...validateSourceDocumentInput({
      filename: input.filename,
      byteSize: input.buffer.byteLength,
      declaredMime,
      sourceType: input.sourceType,
    }),
    ...validateSourceBytes({ sourceType: input.sourceType, buffer: input.buffer }),
  ];
  if (validationErrors.length > 0) {
    throw new Error(`SOURCE_DOCUMENT_INVALID:${[...new Set(validationErrors)].join(',')}`);
  }
  const sha256 = hashSourceBytes(input.buffer);
  const tenantId = input.tenantId ?? PLATFORM_PRODUCT_REGISTRATION_TENANT_ID;
  const existing = await findSourceDocumentByHash(input.supabase, tenantId, sha256, input.buffer.byteLength);
  if (existing) {
    await recordSourceUploadEvent(input.supabase, {
      tenantId,
      sourceDocument: existing,
      requestKey: input.requestKey,
      sourceChannel: input.sourceChannel,
      metadata: input.metadata,
    });
    return existing;
  }

  const safeFilename = input.filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'source.bin';
  const storagePath = `${tenantId}/${sha256}/${safeFilename}`;
  const upload = await input.supabase.storage.from(PRODUCT_SOURCE_BUCKET).upload(storagePath, input.buffer, {
    contentType: declaredMime ?? undefined,
    upsert: false,
  });
  if (upload.error && !/already exists|duplicate/i.test(upload.error.message)) throw upload.error;

  try {
    const created = await createSourceDocumentRecord({
      supabase: input.supabase,
      filename: input.filename,
      byteSize: input.buffer.byteLength,
      declaredMime,
      sourceType: input.sourceType,
      sha256,
      storagePath,
      tenantId,
      uploadedBy: input.uploadedBy,
      metadata: input.metadata,
    });
    await recordSourceUploadEvent(input.supabase, {
      tenantId,
      sourceDocument: created,
      requestKey: input.requestKey,
      sourceChannel: input.sourceChannel,
      metadata: input.metadata,
    });
    return created;
  } catch (error) {
    const raced = await findSourceDocumentByHash(input.supabase, tenantId, sha256, input.buffer.byteLength);
    if (raced) {
      await recordSourceUploadEvent(input.supabase, {
        tenantId,
        sourceDocument: raced,
        requestKey: input.requestKey,
        sourceChannel: input.sourceChannel,
        metadata: input.metadata,
      });
      return raced;
    }
    throw error;
  }
}

async function recordSourceUploadEvent(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    sourceDocument: SourceDocumentRecord;
    requestKey?: string;
    sourceChannel?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (!input.requestKey) return;
  const { error } = await supabase.rpc('record_product_registration_source_upload_event', {
    p_payload: {
      tenant_id: input.tenantId,
      source_document_id: input.sourceDocument.id,
      request_key: input.requestKey,
      source_channel: input.sourceChannel ?? 'upload',
      metadata: input.metadata ?? {},
    },
  });
  // Allows the code and the forward migration to deploy in either order.
  if (error && !/record_product_registration_source_upload_event|schema cache|PGRST202/i.test(error.message)) {
    throw error;
  }
}
