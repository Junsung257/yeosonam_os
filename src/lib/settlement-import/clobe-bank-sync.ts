import { getSecret } from '@/lib/secret-registry';

import type { BankTransactionImportRow } from './bank-transaction-importer';

export interface ClobeNormalizeResult {
  rows: BankTransactionImportRow[];
  errors: Array<{ index: number; reason: string }>;
}

export interface ClobeMcpFetchOptions {
  from?: string;
  to?: string;
  accountNumber?: string;
  limit?: number;
  accessToken?: string;
}

export interface ClobeMcpFetchResult {
  transactions: Record<string, unknown>[];
  toolName: string | null;
  toolNames: string[];
}

interface McpTool {
  name: string;
  description?: string;
}

interface McpCallContext {
  url: string;
  headers: Record<string, string>;
  nextId: number;
  sessionId: string | null;
}

const DEFAULT_CLOBE_MCP_URL = 'https://api.clobe.ai/mcp';
const PROTOCOL_VERSION = '2025-06-18';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getFirstString(raw: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function getFirstNumber(raw: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    if (typeof value === 'string') {
      const n = Number(value.replace(/,/g, '').replace(/[^\d.-]/g, ''));
      if (Number.isFinite(n)) return Math.round(n);
    }
  }
  return null;
}

function normalizeReceivedAt(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.normalize('NFKC').trim();
  const bankDate = normalized.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?/);
  if (bankDate) {
    return `${bankDate[1]}T${bankDate[2]}:${bankDate[3] ?? '00'}+09:00`;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function inferDirection(raw: Record<string, unknown>): 'deposit' | 'withdraw' | null {
  const direction = getFirstString(raw, [
    'direction',
    'transaction_type',
    'transactionType',
    'type',
    'inout',
    'in_out',
    'depositWithdrawal',
  ])?.toLowerCase();
  if (!direction) return null;
  if (/deposit|income|credit|입금|수입|매출/.test(direction)) return 'deposit';
  if (/withdraw|expense|debit|출금|지출|매입/.test(direction)) return 'withdraw';
  return null;
}

export function normalizeClobeBankTransaction(rawInput: unknown, index = 0): BankTransactionImportRow | null {
  const raw = asRecord(rawInput);
  if (Object.keys(raw).length === 0) return null;

  const receivedAt = normalizeReceivedAt(getFirstString(raw, [
    'received_at',
    'receivedAt',
    'posted_at',
    'postedAt',
    'transaction_at',
    'transactionAt',
    'transaction_date',
    'transactionDate',
    'date',
  ]));
  if (!receivedAt) return null;

  const accountNumber = getFirstString(raw, [
    'account_number',
    'accountNumber',
    'account_no',
    'accountNo',
    'bank_account_number',
  ]) ?? undefined;
  const counterpartyName = getFirstString(raw, [
    'counterparty_name',
    'counterpartyName',
    'counterparty',
    'partner_name',
    'partnerName',
    'client_name',
    'clientName',
    'transaction_summary',
    'summary',
    'description',
  ]) ?? '';
  const memo = getFirstString(raw, [
    'memo',
    'note',
    'remark',
    'remarks',
    'user_memo',
    'userMemo',
    'description',
    'label',
  ]) ?? '';

  const explicitDeposit = getFirstNumber(raw, ['deposit_amount', 'depositAmount', 'income', 'credit']);
  const explicitWithdraw = getFirstNumber(raw, ['withdraw_amount', 'withdrawAmount', 'expense', 'debit']);
  let depositAmount = Math.max(0, explicitDeposit ?? 0);
  let withdrawAmount = Math.max(0, explicitWithdraw ?? 0);

  if (depositAmount <= 0 && withdrawAmount <= 0) {
    const signedAmount = getFirstNumber(raw, ['signed_amount', 'signedAmount', 'amount', 'transaction_amount', 'transactionAmount']);
    if (signedAmount == null || signedAmount === 0) return null;
    const direction = inferDirection(raw);
    if (signedAmount < 0 || direction === 'withdraw') withdrawAmount = Math.abs(signedAmount);
    else depositAmount = Math.abs(signedAmount);
  }

  const externalTransactionId = getFirstString(raw, [
    'id',
    'transaction_id',
    'transactionId',
    'external_id',
    'externalId',
    'bank_transaction_id',
    'bankTransactionId',
  ]) ?? undefined;

  return {
    receivedAt,
    depositAmount,
    withdrawAmount,
    counterpartyName,
    memo,
    accountNumber,
    rowIndex: index,
    externalProvider: 'clobe',
    externalTransactionId,
    rawPayload: raw,
  };
}

export function normalizeClobeBankTransactions(payload: unknown): ClobeNormalizeResult {
  const rawRows = extractTransactionArray(payload);
  const rows: BankTransactionImportRow[] = [];
  const errors: Array<{ index: number; reason: string }> = [];

  rawRows.forEach((raw, index) => {
    const normalized = normalizeClobeBankTransaction(raw, index);
    if (normalized) rows.push(normalized);
    else errors.push({ index, reason: 'missing required transaction fields' });
  });

  return { rows, errors };
}

export function extractTransactionArray(payload: unknown): unknown[] {
  if (payload == null) return [];
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (record.structuredContent != null) {
    const structured = extractTransactionArray(record.structuredContent);
    if (structured.length > 0) return structured;
  }
  if (Array.isArray(record.content)) {
    for (const part of record.content) {
      const text = asRecord(part).text;
      if (typeof text === 'string' && text.trim()) {
        try {
          const parsed = JSON.parse(text);
          const rows = extractTransactionArray(parsed);
          if (rows.length > 0) return rows;
        } catch {
          // Ignore non-JSON MCP text content.
        }
      }
    }
  }
  for (const key of ['transactions', 'data', 'items', 'rows', 'results']) {
    const value = record[key];
    if (Array.isArray(value)) return value;
    const nested = asRecord(value);
    for (const nestedKey of ['transactions', 'items', 'rows', 'results']) {
      const nestedValue = nested[nestedKey];
      if (Array.isArray(nestedValue)) return nestedValue;
    }
  }
  return [];
}

function chooseTransactionTool(tools: McpTool[], preferred?: string | null): string | null {
  if (preferred && tools.some(tool => tool.name === preferred)) return preferred;
  const candidates = tools
    .map(tool => ({
      tool,
      text: `${tool.name} ${tool.description ?? ''}`.toLowerCase(),
    }))
    .filter(({ text }) => /(bank|account|transaction|ledger|cash|통장|거래|입출금)/.test(text))
    .sort((a, b) => {
      const aExact = /(transaction|거래|입출금)/.test(a.text) ? 1 : 0;
      const bExact = /(transaction|거래|입출금)/.test(b.text) ? 1 : 0;
      return bExact - aExact;
    });
  return candidates[0]?.tool.name ?? null;
}

async function parseMcpResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const dataLine = text
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(line => line.startsWith('data:'));
    if (!dataLine) return null;
    return JSON.parse(dataLine.slice('data:'.length).trim());
  }
  return JSON.parse(text);
}

async function mcpCall(ctx: McpCallContext, method: string, params?: Record<string, unknown>, notification = false) {
  const headers = { ...ctx.headers };
  if (ctx.sessionId) headers['Mcp-Session-Id'] = ctx.sessionId;

  const body = notification
    ? { jsonrpc: '2.0', method, params: params ?? {} }
    : { jsonrpc: '2.0', id: ctx.nextId++, method, params: params ?? {} };

  const response = await fetch(ctx.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Clobe MCP ${method} failed: ${response.status} ${response.statusText}`);
  }

  const sessionId = response.headers.get('mcp-session-id');
  if (sessionId) ctx.sessionId = sessionId;

  const parsed = await parseMcpResponse(response);
  const record = asRecord(parsed);
  if (record.error) throw new Error(`Clobe MCP ${method} error: ${JSON.stringify(record.error)}`);
  return record.result ?? parsed;
}

async function initializeMcp(ctx: McpCallContext) {
  await mcpCall(ctx, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'yeosonam-os', version: '0.1.0' },
  });
  await mcpCall(ctx, 'notifications/initialized', {}, true);
}

function buildToolArguments(options: ClobeMcpFetchOptions): Record<string, unknown> {
  return {
    ...(options.from ? { from: options.from, startDate: options.from, start_date: options.from } : {}),
    ...(options.to ? { to: options.to, endDate: options.to, end_date: options.to } : {}),
    ...(options.accountNumber ? { accountNumber: options.accountNumber, account_number: options.accountNumber } : {}),
    ...(options.limit ? { limit: options.limit } : {}),
  };
}

export async function fetchClobeMcpBankTransactions(options: ClobeMcpFetchOptions = {}): Promise<ClobeMcpFetchResult> {
  const token = options.accessToken || getSecret('CLOBE_MCP_BEARER_TOKEN') || getSecret('CLOBE_API_TOKEN');
  if (!token) {
    throw new Error('Clobe OAuth connection is required');
  }

  const ctx: McpCallContext = {
    url: getSecret('CLOBE_MCP_URL') || DEFAULT_CLOBE_MCP_URL,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    nextId: 1,
    sessionId: null,
  };

  await initializeMcp(ctx);
  const toolsResult = asRecord(await mcpCall(ctx, 'tools/list'));
  const tools = (Array.isArray(toolsResult.tools) ? toolsResult.tools : []) as McpTool[];
  const toolNames = tools.map(tool => tool.name);
  const toolName = chooseTransactionTool(tools, getSecret('CLOBE_MCP_TRANSACTIONS_TOOL') ?? undefined);
  if (!toolName) {
    throw new Error(`No Clobe MCP transaction tool found. Available tools: ${toolNames.join(', ') || 'none'}`);
  }

  const callResult = await mcpCall(ctx, 'tools/call', {
    name: toolName,
    arguments: buildToolArguments(options),
  });
  const transactions = extractTransactionArray(callResult).filter(item => typeof item === 'object' && item !== null) as Record<string, unknown>[];
  return { transactions, toolName, toolNames };
}
