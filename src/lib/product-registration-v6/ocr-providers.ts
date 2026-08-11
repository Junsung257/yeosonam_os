import { google } from 'googleapis';

import { getSecret, type SecretKey } from '@/lib/secret-registry';

export type OcrLayoutNode = {
  text: string;
  confidence?: number | null;
  boundingBox?: unknown;
};

export type OcrTableCell = {
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
  text: string;
  confidence?: number | null;
  boundingBox?: unknown;
};

export type OcrPage = { page: number; text: string; nodes?: OcrLayoutNode[]; tables?: Array<{ cells: OcrTableCell[] }> };

export type OcrProviderOutput = {
  provider: 'clova' | 'google-document-ai';
  text: string;
  pages: OcrPage[];
  criticalTokens: string[];
  costKrw: number;
  rawModelVersion: string;
};

export type CrossValidatedOcrOutput = {
  text: string;
  pages: OcrPage[];
  parserEngine: string;
  parserVersion: string;
  criticalTokens: string[];
  providerResults: Array<{ provider: string; criticalTokens: string[]; costKrw: number }>;
  totalCostKrw: number;
};

function extractCriticalTokens(text: string): string[] {
  const prices = text.match(/(?:₩|KRW\s*)?\d{1,3}(?:,\d{3})+(?:\s*원)?/g) ?? [];
  const dates = text.match(/(?:20\d{2}[./-])?\d{1,2}[./-]\d{1,2}/g) ?? [];
  const flights = text.match(/\b[A-Z0-9]{2,3}\s?\d{2,4}[A-Z]?\b/g) ?? [];
  return [...new Set([...prices, ...dates, ...flights].map(value => value.replace(/\s+/g, '').toUpperCase()))].sort();
}

function mimeFormat(filename: string, mime: string): string {
  if (mime.includes('pdf') || filename.toLowerCase().endsWith('.pdf')) return 'pdf';
  if (mime.includes('png') || filename.toLowerCase().endsWith('.png')) return 'png';
  return 'jpg';
}

function cost(name: SecretKey): number {
  const parsed = Number(getSecret(name) ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function postJson(url: string, init: RequestInit, timeoutMs = 45_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP_${response.status}:${(await response.text()).slice(0, 500)}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function runClovaOcr(input: {
  buffer: Buffer;
  filename: string;
  mime: string;
}): Promise<OcrProviderOutput> {
  const endpoint = getSecret('CLOVA_OCR_APIGW_URL');
  const secret = getSecret('CLOVA_OCR_SECRET');
  if (!endpoint || !secret) throw new Error('CLOVA_OCR_CREDENTIALS_MISSING');
  const costKrw = cost('CLOVA_OCR_COST_KRW_PER_CALL');
  if (costKrw > 2_000) throw new Error('PROVIDER_COST_LIMIT_EXCEEDED');
  const payload = await postJson(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OCR-SECRET': secret },
    body: JSON.stringify({
      version: 'V2',
      requestId: crypto.randomUUID(),
      timestamp: Date.now(),
      lang: 'ko',
      images: [{
        format: mimeFormat(input.filename, input.mime),
        name: input.filename.slice(0, 100),
        data: input.buffer.toString('base64'),
      }],
      enableTableDetection: true,
    }),
  });
  const images = Array.isArray((payload as { images?: unknown[] })?.images)
    ? (payload as { images: Array<Record<string, unknown>> }).images
    : [];
  const pages = images.map((image, index) => {
    const fields = Array.isArray(image.fields) ? image.fields as Array<Record<string, unknown>> : [];
    const rawTables = Array.isArray(image.tables) ? image.tables as Array<Record<string, unknown>> : [];
    return {
      page: index + 1,
      text: fields.map(field => String(field.inferText ?? '')).filter(Boolean).join(' '),
      nodes: fields.map(field => ({
        text: String(field.inferText ?? '').trim(),
        confidence: Number.isFinite(Number(field.inferConfidence)) ? Number(field.inferConfidence) : null,
        boundingBox: field.boundingPoly ?? null,
      })).filter(node => node.text),
      tables: rawTables.map(table => ({
        cells: (Array.isArray(table.cells) ? table.cells as Array<Record<string, unknown>> : []).map((cell, cellIndex) => ({
          row: Number(cell.rowIndex ?? cell.row ?? 0),
          column: Number(cell.columnIndex ?? cell.column ?? cellIndex),
          rowSpan: Math.max(1, Number(cell.rowSpan ?? 1)),
          colSpan: Math.max(1, Number(cell.columnSpan ?? cell.colSpan ?? 1)),
          text: String(cell.inferText ?? cell.text ?? '').trim(),
          confidence: Number.isFinite(Number(cell.inferConfidence)) ? Number(cell.inferConfidence) : null,
          boundingBox: cell.boundingPoly ?? null,
        })).filter(cell => cell.text),
      })).filter(table => table.cells.length > 0),
    };
  }).filter(page => page.text.trim());
  const text = pages.map(page => page.text).join('\n\n').trim();
  if (text.length < 10) throw new Error('CLOVA_OCR_TEXT_TOO_SHORT');
  return {
    provider: 'clova',
    text,
    pages,
    criticalTokens: extractCriticalTokens(text),
    costKrw,
    rawModelVersion: 'clova-general-v2-table',
  };
}

function anchorText(documentText: string, anchor: unknown): string {
  const segments = (anchor as { textSegments?: Array<{ startIndex?: string | number; endIndex?: string | number }> } | null)?.textSegments;
  if (!Array.isArray(segments)) return '';
  return segments.map(segment => documentText.slice(Number(segment.startIndex ?? 0), Number(segment.endIndex ?? 0))).join('');
}

export async function runGoogleDocumentAi(input: {
  buffer: Buffer;
  mime: string;
}): Promise<OcrProviderOutput> {
  const project = getSecret('GOOGLE_DOCUMENT_AI_PROJECT_ID');
  const location = getSecret('GOOGLE_DOCUMENT_AI_LOCATION') || 'us';
  const processor = getSecret('GOOGLE_DOCUMENT_AI_PROCESSOR_ID');
  const credentialsRaw = getSecret('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!project || !processor || !credentialsRaw) throw new Error('GOOGLE_DOCUMENT_AI_CREDENTIALS_MISSING');
  const costKrw = cost('GOOGLE_DOCUMENT_AI_COST_KRW_PER_CALL');
  if (costKrw > 2_000) throw new Error('PROVIDER_COST_LIMIT_EXCEEDED');
  const credentials = JSON.parse(credentialsRaw) as Record<string, unknown>;
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const accessTokenResult = await client.getAccessToken();
  const accessToken = typeof accessTokenResult === 'string' ? accessTokenResult : accessTokenResult?.token;
  if (!accessToken) throw new Error('GOOGLE_DOCUMENT_AI_TOKEN_UNAVAILABLE');
  const endpoint = `https://${location}-documentai.googleapis.com/v1/projects/${project}/locations/${location}/processors/${processor}:process`;
  const payload = await postJson(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawDocument: { content: input.buffer.toString('base64'), mimeType: input.mime } }),
  });
  const document = (payload as { document?: Record<string, unknown> })?.document ?? {};
  const text = String(document.text ?? '').trim();
  const rawPages = Array.isArray(document.pages) ? document.pages as Array<Record<string, unknown>> : [];
  const pages = rawPages.map((page, index) => {
    const paragraphs = Array.isArray(page.paragraphs) ? page.paragraphs as Array<Record<string, unknown>> : [];
    const tables = Array.isArray(page.tables) ? page.tables as Array<Record<string, unknown>> : [];
    return {
      page: index + 1,
      text: anchorText(text, (page.layout as Record<string, unknown> | undefined)?.textAnchor).trim(),
      nodes: paragraphs.map(paragraph => {
        const layout = paragraph.layout as Record<string, unknown> | undefined;
        return {
          text: anchorText(text, layout?.textAnchor).trim(),
          confidence: Number.isFinite(Number(layout?.confidence)) ? Number(layout?.confidence) : null,
          boundingBox: layout?.boundingPoly ?? null,
        };
      }).filter(node => node.text),
      tables: tables.map(table => {
        const rows = [
          ...(Array.isArray(table.headerRows) ? table.headerRows as Array<Record<string, unknown>> : []),
          ...(Array.isArray(table.bodyRows) ? table.bodyRows as Array<Record<string, unknown>> : []),
        ];
        return {
          cells: rows.flatMap((row, rowIndex) => (Array.isArray(row.cells) ? row.cells as Array<Record<string, unknown>> : []).map((cell, columnIndex) => {
            const layout = cell.layout as Record<string, unknown> | undefined;
            return {
              row: rowIndex,
              column: columnIndex,
              rowSpan: Math.max(1, Number(cell.rowSpan ?? 1)),
              colSpan: Math.max(1, Number(cell.colSpan ?? 1)),
              text: anchorText(text, layout?.textAnchor).trim(),
              confidence: Number.isFinite(Number(layout?.confidence)) ? Number(layout?.confidence) : null,
              boundingBox: layout?.boundingPoly ?? null,
            };
          })),
        };
      }).filter(table => table.cells.length > 0),
    };
  });
  if (text.length < 10) throw new Error('GOOGLE_DOCUMENT_AI_TEXT_TOO_SHORT');
  return {
    provider: 'google-document-ai',
    text,
    pages: pages.some(page => page.text) ? pages : [{ page: 1, text }],
    criticalTokens: extractCriticalTokens(text),
    costKrw,
    rawModelVersion: String((payload as { processorVersion?: string }).processorVersion ?? 'document-ai-processor'),
  };
}

export async function extractOcrWithCrossValidation(input: {
  buffer: Buffer;
  filename: string;
  mime: string;
}): Promise<CrossValidatedOcrOutput> {
  const ocrEnabled = getSecret('PRODUCT_REGISTRATION_V6_OCR_ENABLED')
    ?? getSecret('PRODUCT_REGISTRATION_V4_OCR_ENABLED');
  if (ocrEnabled !== '1') {
    throw new Error('OCR_PROFILE_DISABLED:PRODUCT_REGISTRATION_V6_OCR_ENABLED is not enabled');
  }
  const estimatedTotal = cost('CLOVA_OCR_COST_KRW_PER_CALL') + cost('GOOGLE_DOCUMENT_AI_COST_KRW_PER_CALL');
  if (estimatedTotal > 2_000) throw new Error('DOCUMENT_EXTERNAL_COST_LIMIT_EXCEEDED');
  const primary = await runClovaOcr(input);
  let secondary: OcrProviderOutput;
  try {
    secondary = await runGoogleDocumentAi({ buffer: input.buffer, mime: input.mime });
  } catch (error) {
    if (primary.criticalTokens.length > 0) {
      throw new Error(`OCR_SECONDARY_PROVIDER_REQUIRED:${error instanceof Error ? error.message : String(error)}`);
    }
    secondary = {
      provider: 'google-document-ai',
      text: '',
      pages: [],
      criticalTokens: [],
      costKrw: 0,
      rawModelVersion: 'unavailable',
    };
  }
  const totalCostKrw = primary.costKrw + secondary.costKrw;
  if (totalCostKrw > 2_000) throw new Error('DOCUMENT_EXTERNAL_COST_LIMIT_EXCEEDED');
  if (primary.criticalTokens.join('|') !== secondary.criticalTokens.join('|')) {
    throw new Error('OCR_CRITICAL_VALUE_MISMATCH:price/date/flight values disagree across CLOVA and Google');
  }
  return {
    text: primary.text,
    pages: primary.pages,
    parserEngine: 'clova-ocr+google-document-ai',
    parserVersion: `${primary.rawModelVersion}+${secondary.rawModelVersion}`,
    criticalTokens: primary.criticalTokens,
    providerResults: [primary, secondary].map(result => ({
      provider: result.provider,
      criticalTokens: result.criticalTokens,
      costKrw: result.costKrw,
    })),
    totalCostKrw,
  };
}
