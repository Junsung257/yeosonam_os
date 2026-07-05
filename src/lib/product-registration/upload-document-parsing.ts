import type { SupabaseClient } from '@supabase/supabase-js';

import { parseDocument, type ParsedDocument, type ParseOptions } from '@/lib/parser';
import { computeNormalizedContentHash } from '@/lib/parser/upload-text-hash';
import { getLandOperatorProfile } from '@/lib/land-operator-profile';
import { getRegionCacheContext } from '@/lib/region-cache-context';
import { getRelevantReflections } from '@/lib/reflection-memory';
import { isStandardProductMarkdown, parseStandardProductMarkdown } from '@/lib/standard-product-markdown';
import {
  checkParsedDocumentNormalizedDuplicate,
  type UploadDuplicateCheckResult,
} from './upload-document-hashes';
import { applyUploadV2Preflight } from './upload-preflight';

export type UploadDocumentParsingResult = {
  duplicate: UploadDuplicateCheckResult;
  parsedDocument: ParsedDocument;
  normalizedCatalogHash: string;
  productRegistrationV2GateFailures: string[];
};

async function buildUploadParseOptions(input: {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  tempDestination: string | null;
  prelimLandOperatorId: string | null;
}): Promise<ParseOptions> {
  if (!input.isSupabaseConfigured) return {};

  const [reflections, regionContext, landOperatorProfile] = await Promise.all([
    getRelevantReflections(input.supabase, {
      destination: input.tempDestination || undefined,
      landOperatorId: input.prelimLandOperatorId || undefined,
      minSeverity: 'medium',
      limit: 5,
    }).catch(() => []),
    input.tempDestination ? getRegionCacheContext(input.tempDestination).catch(() => '') : Promise.resolve(''),
    input.prelimLandOperatorId ? getLandOperatorProfile(input.prelimLandOperatorId).catch(() => null) : Promise.resolve(null),
  ]);
  if (reflections.length > 0) {
    console.log('[Upload API] Reflexion loaded:', reflections.length, 'items (destination:', input.tempDestination, ')');
  }
  if (regionContext) {
    console.log('[Upload API] region context loaded:', input.tempDestination, regionContext.length, 'chars');
  }
  if (landOperatorProfile) {
    console.log('[Upload API] land operator profile loaded:', landOperatorProfile.total_registrations, 'registrations, avg conf:', landOperatorProfile.avg_confidence);
  }

  return { reflections, regionContext, landOperatorProfile: landOperatorProfile ?? undefined };
}

export async function parseUploadDocumentForRegistration(input: {
  buffer: Buffer;
  fileName: string;
  directRawText: string | null;
  originalRawText?: string | null;
  parserRawText?: string | null;
  analysisNormalizedText?: string | null;
  tempDestination: string | null;
  prelimLandOperatorId: string | null;
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  fileHash: string;
}): Promise<UploadDocumentParsingResult> {
  const parseOptions = await buildUploadParseOptions({
    supabase: input.supabase,
    isSupabaseConfigured: input.isSupabaseConfigured,
    tempDestination: input.tempDestination,
    prelimLandOperatorId: input.prelimLandOperatorId,
  });

  const rawTextForParser = input.parserRawText ?? input.directRawText;
  const shouldBypassLegacyParserForRawText =
    Boolean(rawTextForParser)
    && !isStandardProductMarkdown(rawTextForParser ?? '')
    && process.env.RAW_UPLOAD_NORMALIZER_ENABLED !== '0';

  let parsedDocument = rawTextForParser && isStandardProductMarkdown(rawTextForParser)
    ? parseStandardProductMarkdown(rawTextForParser, input.fileName)
    : shouldBypassLegacyParserForRawText
      ? {
          filename: input.fileName,
          fileType: 'hwp' as const,
          rawText: rawTextForParser ?? '',
          extractedData: { rawText: rawTextForParser ?? '' },
          parsedAt: new Date(),
          confidence: 0,
        }
      : await parseDocument(input.buffer, input.fileName, parseOptions);

  if (!rawTextForParser && isStandardProductMarkdown(parsedDocument.rawText ?? '')) {
    parsedDocument = parseStandardProductMarkdown(parsedDocument.rawText, input.fileName);
  }

  const v2Preflight = await applyUploadV2Preflight(parsedDocument);
  const productRegistrationV2GateFailures = v2Preflight.gateFailures;
  if (v2Preflight.applied) {
    console.log('[Upload API] Product Registration V2 applied:', parsedDocument.multiProducts?.length ?? 0);
  } else if (productRegistrationV2GateFailures.length > 0) {
    console.warn('[Upload API] Product Registration V2 gate failed; keeping parsed result:', productRegistrationV2GateFailures.slice(0, 3).join(' | '));
  }

  const normalizedCatalogHash = computeNormalizedContentHash(parsedDocument.rawText ?? '');
  const duplicate = await checkParsedDocumentNormalizedDuplicate({
    supabase: input.supabase,
    isSupabaseConfigured: input.isSupabaseConfigured,
    directRawText: input.originalRawText ?? input.directRawText,
    parsedRawText: parsedDocument.rawText ?? '',
    normalizedCatalogHash,
    fileHash: input.fileHash,
  });

  return {
    duplicate,
    parsedDocument,
    normalizedCatalogHash,
    productRegistrationV2GateFailures,
  };
}
