import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { google } from 'googleapis';

import { getSecret, type SecretKey } from '@/lib/secret-registry';

const execFile = promisify(execFileCallback);

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
  provider: 'clova' | 'google-document-ai' | 'paddleocr-local' | 'tesseract-local';
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
  providerResults: Array<{
    provider: string;
    criticalTokens: string[];
    costKrw: number;
    modelVersion?: string;
  }>;
  totalCostKrw: number;
};

export function extractOcrCriticalTokens(text: string): string[] {
  const prices = text.match(/(?:₩|￦|KRW|USD|\$)?\s*\d{1,3}(?:,\d{3})+(?:\s*(?:원|달러|USD))?/giu) ?? [];
  const unformattedPrices = text.match(/(?:₩|￦|KRW|USD|\$)\s*\d{4,7}(?:\s*(?:원|달러|USD))?|\d{4,7}\s*원/giu) ?? [];
  const dates = text.match(/(?:20\d{2}[./-])?\d{1,2}[./-]\d{1,2}/g) ?? [];
  const flights = text.match(/\b(?:[A-Z]{2,3}|[A-Z]\d|\d[A-Z])\s?\d{2,4}[A-Z]?\b/g) ?? [];
  return [...new Set([...prices, ...unformattedPrices, ...dates, ...flights]
    .map(value => value.replace(/\s+/g, '').toUpperCase()))].sort();
}

function canonicalCriticalToken(token: string): string {
  const normalized = token.normalize('NFKC').replace(/\s+/g, '').toUpperCase();
  if (/^(?:20\d{2}[./-])?\d{1,2}[./-]\d{1,2}$/.test(normalized)) {
    return `date:${normalized.replace(/[./-]/g, '-')}`;
  }
  if (/(?:₩|￦|KRW|USD|\$|원|달러)/.test(normalized) || /^\d{1,3}(?:,\d{3})+$/.test(normalized)) {
    const digits = normalized.replace(/\D/g, '');
    if (digits.length >= 4) return `price:${digits}`;
  }
  if (/^(?:[A-Z]{2,3}|[A-Z]\d|\d[A-Z])\d{2,4}[A-Z]?$/.test(normalized)) {
    return `flight:${normalized}`;
  }
  return `raw:${normalized}`;
}

export function ocrCriticalTokensMatch(primary: string[], secondary: string[]): boolean {
  return [...new Set(primary.map(canonicalCriticalToken))].sort().join('|')
    === [...new Set(secondary.map(canonicalCriticalToken))].sort().join('|');
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

export type OcrProviderMode = 'local' | 'cloud';

export function getOcrProviderMode(): OcrProviderMode {
  return getSecret('PRODUCT_REGISTRATION_OCR_PROVIDER_MODE')?.toLowerCase() === 'cloud'
    ? 'cloud'
    : 'local';
}

type LocalOcrKind = 'paddleocr-local' | 'tesseract-local';

function localOcrSetting(kind: LocalOcrKind): {
  commandKey: SecretKey;
  argsKey: SecretKey;
  versionKey: SecretKey;
  missingCode: string;
} {
  if (kind === 'paddleocr-local') {
    return {
      commandKey: 'PADDLEOCR_LOCAL_COMMAND',
      argsKey: 'PADDLEOCR_LOCAL_ARGS_JSON',
      versionKey: 'PADDLEOCR_LOCAL_VERSION',
      missingCode: 'PADDLEOCR_LOCAL_COMMAND_MISSING',
    };
  }
  return {
    commandKey: 'TESSERACT_LOCAL_COMMAND',
    argsKey: 'TESSERACT_LOCAL_ARGS_JSON',
    versionKey: 'TESSERACT_LOCAL_VERSION',
    missingCode: 'TESSERACT_LOCAL_COMMAND_MISSING',
  };
}

function localOcrArgs(kind: LocalOcrKind): string[] {
  const setting = localOcrSetting(kind);
  const raw = getSecret(setting.argsKey);
  if (!raw) return kind === 'tesseract-local'
    ? ['{input}', 'stdout', '-l', 'kor+eng', '--psm', '6']
    : ['{input}'];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${kind.toUpperCase().replaceAll('-', '_')}_ARGS_JSON_INVALID`);
  }
  if (!Array.isArray(parsed) || parsed.length > 32 || parsed.some(value => typeof value !== 'string' || value.length > 2_000)) {
    throw new Error(`${kind.toUpperCase().replaceAll('-', '_')}_ARGS_JSON_INVALID`);
  }
  return parsed as string[];
}

function localOcrInputExtension(filename: string, mime: string): string {
  if (mime.includes('pdf') || filename.toLowerCase().endsWith('.pdf')) return 'pdf';
  if (mime.includes('png') || filename.toLowerCase().endsWith('.png')) return 'png';
  return 'jpg';
}

function localOcrPages(value: unknown): OcrPage[] {
  if (!Array.isArray(value)) return [];
  return value.map((page, pageIndex) => {
    const record = page && typeof page === 'object' ? page as Record<string, unknown> : {};
    const nodes: OcrLayoutNode[] = [];
    if (Array.isArray(record.nodes)) {
      for (const node of record.nodes) {
        const item = node && typeof node === 'object' ? node as Record<string, unknown> : {};
        const text = String(item.text ?? '').trim();
        if (!text) continue;
        nodes.push({
          text,
          confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : null,
          boundingBox: item.boundingBox ?? null,
        });
      }
    }
    const tables: Array<{ cells: OcrTableCell[] }> = [];
    if (Array.isArray(record.tables)) {
      for (const table of record.tables) {
        const tableRecord = table && typeof table === 'object' ? table as Record<string, unknown> : {};
        const cells: OcrTableCell[] = [];
        if (Array.isArray(tableRecord.cells)) {
          for (const [cellIndex, cell] of tableRecord.cells.entries()) {
            const item = cell && typeof cell === 'object' ? cell as Record<string, unknown> : {};
            const text = String(item.text ?? '').trim();
            if (!text) continue;
            const row = Number(item.row ?? 0);
            const column = Number(item.column ?? cellIndex);
            const rowSpan = Number(item.rowSpan ?? 1);
            const colSpan = Number(item.colSpan ?? 1);
            cells.push({
              row: Number.isFinite(row) ? Math.max(0, row) : 0,
              column: Number.isFinite(column) ? Math.max(0, column) : cellIndex,
              rowSpan: Number.isFinite(rowSpan) ? Math.max(1, rowSpan) : 1,
              colSpan: Number.isFinite(colSpan) ? Math.max(1, colSpan) : 1,
              text,
              confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : null,
              boundingBox: item.boundingBox ?? null,
            });
          }
        }
        if (cells.length > 0) tables.push({ cells });
      }
    }
    const text = String(record.text ?? '').trim() || nodes.map(node => node.text).join(' ').trim();
    const pageNumber = Number(record.page ?? pageIndex + 1);
    return { page: Number.isFinite(pageNumber) ? Math.max(1, pageNumber) : pageIndex + 1, text, nodes, tables };
  }).filter(page => Boolean(page.text || page.nodes.length || page.tables.length));
}

export function parseLocalOcrOutput(input: {
  kind: LocalOcrKind;
  stdout: string;
  modelVersion?: string | null;
}): OcrProviderOutput {
  const stdout = input.stdout.trim();
  if (stdout.length > 4 * 1024 * 1024) throw new Error('LOCAL_OCR_OUTPUT_TOO_LARGE');
  let parsed: Record<string, unknown> | null = null;
  try {
    const value = JSON.parse(stdout) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Record<string, unknown>;
  } catch {
    const jsonLine = stdout.split(/\r?\n/).map(line => line.trim()).reverse().find(line => line.startsWith('{') && line.endsWith('}'));
    if (jsonLine) {
      try {
        const value = JSON.parse(jsonLine) as unknown;
        if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Record<string, unknown>;
      } catch {
        parsed = null;
      }
    }
  }
  if (input.kind === 'paddleocr-local' && !parsed) {
    throw new Error('PADDLEOCR_LOCAL_JSON_REQUIRED');
  }
  const pages = localOcrPages(parsed?.pages);
  const text = String(parsed?.text ?? (input.kind === 'tesseract-local' ? stdout : pages.map(page => page.text).join('\n\n'))).trim();
  if (text.length < 10) throw new Error(`${input.kind.toUpperCase().replaceAll('-', '_')}_TEXT_TOO_SHORT`);
  const normalizedPages = pages.length > 0 ? pages : [{
    page: 1,
    text,
    nodes: text.split(/\r?\n/).map(line => ({ text: line.trim(), confidence: null, boundingBox: null })).filter(node => node.text),
    tables: [],
  }];
  return {
    provider: input.kind,
    text,
    pages: normalizedPages,
    criticalTokens: extractOcrCriticalTokens(text),
    costKrw: 0,
    rawModelVersion: String(parsed?.rawModelVersion ?? input.modelVersion ?? 'configured-local'),
  };
}

async function runLocalOcr(kind: LocalOcrKind, input: { buffer: Buffer; filename: string; mime: string }): Promise<OcrProviderOutput> {
  const setting = localOcrSetting(kind);
  const command = getSecret(setting.commandKey);
  if (!command) throw new Error(setting.missingCode);
  // execFile does not invoke a shell, so spaces in a Windows installation path
  // (for example `C:\\Program Files\\Tesseract-OCR\\tesseract.exe`) are safe.
  // Reject control characters instead of rejecting valid paths with spaces.
  if (command.length > 260 || /[\r\n]/.test(command)) throw new Error(`${kind.toUpperCase().replaceAll('-', '_')}_COMMAND_INVALID`);
  const args = localOcrArgs(kind);
  const workDir = await mkdtemp(join(tmpdir(), 'yeosonam-ocr-'));
  const inputPath = join(workDir, `source.${localOcrInputExtension(input.filename, input.mime)}`);
  try {
    await writeFile(inputPath, input.buffer, { flag: 'wx' });
    const finalArgs = args.map(arg => arg === '{input}' ? inputPath : arg);
    if (!finalArgs.includes(inputPath)) finalArgs.push(inputPath);
    let stdout: string;
    try {
      const result = await execFile(command, finalArgs, {
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        encoding: 'utf8',
      });
      stdout = String(result.stdout ?? '');
    } catch {
      throw new Error(`${kind.toUpperCase().replaceAll('-', '_')}_EXECUTION_FAILED`);
    }
    return parseLocalOcrOutput({
      kind,
      stdout,
      modelVersion: getSecret(setting.versionKey),
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export function runPaddleOcrLocal(input: { buffer: Buffer; filename: string; mime: string }): Promise<OcrProviderOutput> {
  return runLocalOcr('paddleocr-local', input);
}

export function runTesseractLocal(input: { buffer: Buffer; filename: string; mime: string }): Promise<OcrProviderOutput> {
  return runLocalOcr('tesseract-local', input);
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
    criticalTokens: extractOcrCriticalTokens(text),
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
    criticalTokens: extractOcrCriticalTokens(text),
    costKrw,
    rawModelVersion: String((payload as { processorVersion?: string }).processorVersion ?? 'document-ai-processor'),
  };
}

async function extractWithCloudCrossValidation(input: {
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
  if (!ocrCriticalTokensMatch(primary.criticalTokens, secondary.criticalTokens)) {
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
      modelVersion: result.rawModelVersion,
    })),
    totalCostKrw,
  };
}

async function extractWithLocalCrossValidation(input: {
  buffer: Buffer;
  filename: string;
  mime: string;
}): Promise<CrossValidatedOcrOutput> {
  const primary = await runPaddleOcrLocal(input);
  const secondary = await runTesseractLocal(input);
  if (!ocrCriticalTokensMatch(primary.criticalTokens, secondary.criticalTokens)) {
    throw new Error('OCR_CRITICAL_VALUE_MISMATCH:paddleocr-local+tesseract-local');
  }
  return {
    text: primary.text,
    pages: primary.pages,
    parserEngine: 'paddleocr-local+tesseract-local',
    parserVersion: `${primary.rawModelVersion}+${secondary.rawModelVersion}`,
    criticalTokens: primary.criticalTokens,
    providerResults: [primary, secondary].map(result => ({
      provider: result.provider,
      criticalTokens: result.criticalTokens,
      costKrw: 0,
      modelVersion: result.rawModelVersion,
    })),
    totalCostKrw: 0,
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
  return getOcrProviderMode() === 'cloud'
    ? extractWithCloudCrossValidation(input)
    : extractWithLocalCrossValidation(input);
}
