import { createHash } from 'crypto';

import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin } from '@/lib/supabase';

export type UploadLandOperatorRow = {
  id: string;
  name: string;
};

export type UploadDepartingLocationRow = {
  id: string;
  name: string;
};

export type UploadFilenameRule = {
  supplierRaw?: string;
  marginRate?: number;
  cleanName: string;
};

export type SupplierIdentificationResult = {
  supplierRaw: string | null;
  supplierCode: string;
  landOperatorId: string | null;
  identificationSource: 'filename' | 'text_regex' | 'rag_flywheel' | 'llm_inference' | 'unknown';
};

const SUPPLIER_MAP: Record<string, string> = {
  '참좋은여행': 'CJ',
  '온라인투어': 'OL',
  '베스트아시아': 'BA',
  '노랑풍선': 'NY',
  '롯데관광': 'LO',
  '교원투어': 'KW',
  '인터파크': 'IP',
  '여행박사': 'YB',
  '자유투어': 'JY',
  '삼중투어': 'SJ',
  '하나투어': 'HN',
  '모두투어': 'MD',
  '투어피': 'TP',
  '투어비': 'TB',
};

export function parseFilename(filename: string): UploadFilenameRule {
  const base = filename.replace(/\.\w+$/, '');
  const pctMatch = filename.match(/(\d+(?:\.\d+)?)%/);
  const marginRate = pctMatch ? parseFloat(pctMatch[1]) / 100 : undefined;

  const bracketMatch = filename.match(/^\[([^_\]]+)_\d+(?:\.\d+)?%?\](.+)\.\w+$/);
  if (bracketMatch) {
    return {
      supplierRaw: bracketMatch[1].trim(),
      marginRate,
      cleanName: bracketMatch[2].trim(),
    };
  }

  let supplierRaw: string | undefined;
  for (const key of Object.keys(SUPPLIER_MAP)) {
    if (base.includes(key)) {
      supplierRaw = key;
      break;
    }
  }

  return { supplierRaw, marginRate, cleanName: base };
}

export function resolveSupplierCode(supplierRaw?: string): string {
  if (!supplierRaw) return 'ETC';
  if (supplierRaw.includes('투어코코넛')) return 'TC';
  if (SUPPLIER_MAP[supplierRaw]) return SUPPLIER_MAP[supplierRaw];
  for (const [key, code] of Object.entries(SUPPLIER_MAP)) {
    if (supplierRaw.includes(key)) return code;
  }
  return 'ETC';
}

export function resolveLandOperatorId(
  supplierRaw: string | undefined,
  ops: UploadLandOperatorRow[],
): string | null {
  if (!supplierRaw || !ops.length) return null;
  return ops.find(op => supplierRaw.includes(op.name) || op.name.includes(supplierRaw))?.id ?? null;
}

export async function identifySupplierFromText(
  extractedText: string,
  ops: UploadLandOperatorRow[],
): Promise<SupplierIdentificationResult> {
  const unknown: SupplierIdentificationResult = {
    supplierRaw: null,
    supplierCode: 'ETC',
    landOperatorId: null,
    identificationSource: 'unknown',
  };
  if (!extractedText || !ops.length) return unknown;

  const lower = extractedText.toLowerCase();
  for (const op of ops) {
    if (lower.includes(op.name.toLowerCase())) {
      return {
        supplierRaw: op.name,
        supplierCode: resolveSupplierCode(op.name),
        landOperatorId: op.id,
        identificationSource: 'text_regex',
      };
    }
  }

  try {
    const fingerprint = createHash('sha256')
      .update(extractedText.slice(0, 500))
      .digest('hex');
    const { data: log } = await supabaseAdmin
      .from('ai_training_logs')
      .select('human_corrected_json, correction_diff')
      .filter("ai_parsed_json->>'text_fingerprint'", 'eq', fingerprint)
      .not('correction_diff', 'is', null)
      .limit(1)
      .maybeSingle();

    if (log) {
      const diff = (log as { correction_diff?: Record<string, { from: string; to: string }> | null }).correction_diff ?? null;
      const corrected = (log as { human_corrected_json?: Record<string, string> | null }).human_corrected_json ?? null;
      const supplierCode = diff?.supplier_code?.to;
      const supplierName = corrected?.supplier_name ?? null;
      const landOperatorId = corrected?.land_operator_id ?? null;
      if (supplierCode && supplierCode !== 'ETC' && supplierName && landOperatorId) {
        return {
          supplierRaw: supplierName,
          supplierCode,
          landOperatorId,
          identificationSource: 'rag_flywheel',
        };
      }
    }
  } catch (e) {
    console.warn('[identifySupplier] RAG lookup failed:', e);
  }

  try {
    const apiKey = getSecret('GOOGLE_AI_API_KEY') || getSecret('GOOGLE_GEMINI_API_KEY') || getSecret('GOOGLE_API_KEY') || '';
    if (!apiKey) return unknown;
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const snippet = extractedText.slice(0, 400) + '\n...\n' + extractedText.slice(-300);
    const prompt = 'Find the land operator or supplier name in this travel document. Return JSON only: {"supplier_name": "name or null"}\n\n' + snippet;
    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();
    const match = responseText.match(/\{[\s\S]*\}/);
    if (!match) return unknown;
    const inferred: string | null = JSON.parse(match[0])?.supplier_name ?? null;
    if (!inferred || inferred === 'null') return unknown;
    const found = ops.find(op => (
      inferred.toLowerCase().includes(op.name.toLowerCase())
      || op.name.toLowerCase().includes(inferred.toLowerCase())
    ));
    if (found) {
      return {
        supplierRaw: found.name,
        supplierCode: resolveSupplierCode(found.name),
        landOperatorId: found.id,
        identificationSource: 'llm_inference',
      };
    }
  } catch (e) {
    console.warn('[identifySupplier] LLM inference failed:', e);
  }

  return unknown;
}

export function resolveDepartingLocationId(
  departureText: string | undefined,
  locs: UploadDepartingLocationRow[],
): string | null {
  if (!departureText || !locs.length) return null;
  return locs.find(loc => departureText.includes(loc.name) || loc.name.includes(departureText))?.id ?? null;
}
