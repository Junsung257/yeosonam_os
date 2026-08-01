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
  diagnosticsOnly?: boolean;
  companyId?: string;
  accountId?: string;
  cursor?: string;
}

export interface ClobeMcpToolSummary {
  name: string;
  description: string | null;
  required: string[];
  properties: string[];
  inputFields: Array<{
    path: string;
    type: string | null;
    required: boolean;
    description: string | null;
    values: string[];
  }>;
}

export interface ClobeMcpFetchResult {
  transactions: Record<string, unknown>[];
  toolName: string | null;
  toolNames: string[];
  attempts: ClobeMcpFetchAttempt[];
  bankToolAvailable: boolean;
  tools: ClobeMcpToolSummary[];
}

export interface ClobeMcpFetchAttempt {
  toolName: string;
  extracted: number;
  normalized: number;
  resultKeys: string[];
  contentTypes: string[];
  error?: string;
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: {
    properties?: Record<string, unknown>;
    required?: string[];
  };
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
  if (direction === 'in') return 'deposit';
  if (direction === 'out') return 'withdraw';
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
    'transacted_at',
    'transactedAt',
    'traded_at',
    'tradedAt',
    'occurred_at',
    'occurredAt',
    'date',
  ]));
  if (!receivedAt) return null;

  const accountNumber = getFirstString(raw, [
    'account_number',
    'accountNumber',
    'account_no',
    'accountNo',
    'bank_account_number',
    'bankAccountNumber',
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
    'transactionName',
    'transaction_name',
    'bankTransactionName',
    'bank_transaction_name',
    'displayName',
    'transactionContent',
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
    'transactionMemo',
    'transaction_memo',
  ]) ?? '';

  const explicitDeposit = getFirstNumber(raw, ['deposit_amount', 'depositAmount', 'income', 'credit']);
  const explicitWithdraw = getFirstNumber(raw, ['withdraw_amount', 'withdrawAmount', 'expense', 'debit']);
  let depositAmount = Math.max(0, explicitDeposit ?? 0);
  let withdrawAmount = Math.max(0, explicitWithdraw ?? 0);

  if (depositAmount <= 0 && withdrawAmount <= 0) {
    const signedAmount = getFirstNumber(raw, [
      'signed_amount',
      'signedAmount',
      'amount',
      'amountKrw',
      'amount_krw',
      'transaction_amount',
      'transactionAmount',
    ]);
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
  if (typeof payload === 'string') return extractTabSeparatedRows(payload);
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
          const rows = extractTabSeparatedRows(text);
          if (rows.length > 0) return rows;
        }
      }
    }
  }
  for (const key of [
    'transactions',
    'bankTransactions',
    'bank_transactions',
    'entries',
    'records',
    'ledgerEntries',
    'journalEntries',
    'data',
    'items',
    'rows',
    'results',
  ]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
    const nested = asRecord(value);
    for (const nestedKey of ['transactions', 'bankTransactions', 'bank_transactions', 'entries', 'records', 'items', 'rows', 'results']) {
      const nestedValue = nested[nestedKey];
      if (Array.isArray(nestedValue)) return nestedValue;
    }
  }
  return [];
}

function extractTabSeparatedRows(text: string): Record<string, unknown>[] {
  return text
    .replace(/```(?:text|tsv|csv)?/gi, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /^\d{4}[-/.]\d{2}[-/.]\d{2}[ T]\d{2}:\d{2}/.test(line) && /\t/.test(line))
    .map(line => {
      const parts = line.split('\t').map(part => part.trim());
      return {
        transactionDate: parts[0],
        accountNumber: parts[1] || undefined,
        counterpartyName: parts[3] || parts[2] || '',
        amount: parts[4] || undefined,
        memo: parts[5] || '',
      };
    });
}

function summarizeMcpResult(payload: unknown): Pick<ClobeMcpFetchAttempt, 'resultKeys' | 'contentTypes'> {
  const record = asRecord(payload);
  const content = Array.isArray(record.content) ? record.content : [];
  return {
    resultKeys: Object.keys(record).slice(0, 20),
    contentTypes: content
      .map(part => {
        const value = asRecord(part).type;
        return typeof value === 'string' ? value : 'unknown';
      })
      .slice(0, 10),
  };
}

function toolText(tool: McpTool): string {
  return `${tool.name} ${tool.description ?? ''}`.toLowerCase();
}

function extractMcpData(payload: unknown): unknown {
  const record = asRecord(payload);
  if (record.structuredContent != null) return record.structuredContent;
  if (Array.isArray(record.content)) {
    for (const part of record.content) {
      const text = asRecord(part).text;
      if (typeof text !== 'string' || !text.trim()) continue;
      try {
        return JSON.parse(text);
      } catch {
        continue;
      }
    }
  }
  return payload;
}

function findValuesByKey(payload: unknown, keys: string[], depth = 0): unknown[] {
  if (depth > 7 || payload == null) return [];
  if (Array.isArray(payload)) {
    return payload.flatMap(item => findValuesByKey(item, keys, depth + 1));
  }
  const record = asRecord(payload);
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (keys.includes(key)) values.push(value);
    if (value && typeof value === 'object') {
      values.push(...findValuesByKey(value, keys, depth + 1));
    }
  }
  return values;
}

function resolveCompanyIds(payload: unknown, configured?: string): string[] {
  if (configured?.trim()) return [configured.trim()];
  const data = extractMcpData(payload);
  const directIds = findValuesByKey(data, ['companyId']);
  const companyIds = findValuesByKey(data, ['companies'])
    .flatMap(value => Array.isArray(value) ? value : [])
    .map(company => getFirstString(asRecord(company), ['companyId', 'id']))
    .filter((value): value is string => Boolean(value));
  const ids = [...directIds, ...companyIds]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => value.trim());
  return [...new Set(ids)];
}

function resolveAccountId(payload: unknown, accountNumber?: string, configured?: string): string | null {
  if (configured?.trim()) return configured.trim();
  if (!accountNumber) return null;
  const normalizedAccount = accountNumber.replace(/\D/g, '');
  const data = extractMcpData(payload);
  const candidates = [
    ...findValuesByKey(data, ['accounts', 'bankAccounts'])
      .flatMap(value => Array.isArray(value) ? value : []),
    ...extractTransactionArray(data),
  ];
  for (const candidate of candidates) {
    const account = asRecord(candidate);
    const number = getFirstString(account, [
      'accountNumber',
      'account_number',
      'accountNo',
      'bankAccountNumber',
      'bankAccountNo',
      'maskedAccountNumber',
    ])?.replace(/\D/g, '');
    const id = getFirstString(account, ['bankAccountId', 'accountId', 'id']);
    if (!id || !number) continue;
    const exact = number === normalizedAccount;
    const unmaskedPartial = number.length >= 8 && normalizedAccount.length >= 8
      && number.slice(0, 4) === normalizedAccount.slice(0, 4)
      && number.slice(-4) === normalizedAccount.slice(-4);
    if (exact || unmaskedPartial) {
      return id;
    }
  }
  return null;
}

function paginationState(payload: unknown): { hasNext: boolean; nextCursor: string | null } {
  const data = extractMcpData(payload);
  const hasNext = findValuesByKey(data, ['hasNext']).find(value => typeof value === 'boolean') === true;
  const cursor = findValuesByKey(data, ['nextCursor']).find(value => typeof value === 'string' && value.trim());
  return { hasNext, nextCursor: typeof cursor === 'string' ? cursor : null };
}

function summarizeInputFields(
  schemaValue: unknown,
  prefix = '',
  depth = 0,
): ClobeMcpToolSummary['inputFields'] {
  if (depth > 5) return [];
  const schema = asRecord(schemaValue);
  const properties = asRecord(schema.properties);
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter(value => typeof value === 'string') : []);
  const fields: ClobeMcpToolSummary['inputFields'] = [];

  for (const [name, rawProperty] of Object.entries(properties)) {
    const property = asRecord(rawProperty);
    const path = prefix ? `${prefix}.${name}` : name;
    fields.push({
      path,
      type: typeof property.type === 'string' ? property.type : null,
      required: required.has(name),
      description: typeof property.description === 'string' ? property.description : null,
      values: Array.isArray(property.enum)
        ? property.enum.filter(value => typeof value === 'string').slice(0, 30) as string[]
        : [],
    });
    fields.push(...summarizeInputFields(property, path, depth + 1));
    for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
      const branches = Array.isArray(property[keyword]) ? property[keyword] : [];
      branches.slice(0, 10).forEach(branch => {
        fields.push(...summarizeInputFields(branch, path, depth + 1));
      });
    }
  }

  return fields.slice(0, 200);
}

export function rankTransactionTools(tools: McpTool[], preferred?: string | null): McpTool[] {
  return tools
    .map(tool => ({ tool, text: toolText(tool), name: tool.name.toLowerCase() }))
    .filter(({ name, text }) => {
      const exactClobeReader = name === 'get_labeled_transactions';
      const readVerb = /^(get|list|search|fetch|query|read)_/.test(name);
      const transactionReader = /transactions?|transaction_history|account_statement/.test(name);
      const bankContext = /(bank|account|deposit|withdraw|cash|transaction)/.test(text);
      const mutation = /(bulk|label_|create|update|delete|remove|write|send|post|apply|assign)/.test(name);
      const unrelated = /(tax|invoice|revenue|card_billing|credit_card|journal|ledger|payroll)/.test(name);
      const accountListOnly = /bank_accounts?$/.test(name);
      const labelCatalog = name === 'get_labels';
      return (exactClobeReader || (readVerb && transactionReader && bankContext))
        && !mutation
        && !unrelated
        && !accountListOnly
        && !labelCatalog;
    })
    .sort((a, b) => {
      const aScore = (preferred === a.tool.name ? 100 : 0) + (a.name === 'get_labeled_transactions' ? 50 : 0);
      const bScore = (preferred === b.tool.name ? 100 : 0) + (b.name === 'get_labeled_transactions' ? 50 : 0);
      return bScore - aScore;
    })
    .map(({ tool }) => tool);
}

export function chooseTransactionTool(tools: McpTool[], preferred?: string | null): string | null {
  return rankTransactionTools(tools, preferred)[0]?.name ?? null;
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

interface ClobeTransactionToolArguments {
  companyId: string;
  from?: string;
  to?: string;
  accountId?: string | null;
  cursor?: string | null;
  size: number;
}

function buildTransactionArguments(options: ClobeTransactionToolArguments): Record<string, unknown> {
  return {
    input: {
      companyId: options.companyId,
      ...(options.from ? { startDate: options.from } : {}),
      ...(options.to ? { endDate: options.to } : {}),
      ...(options.accountId ? { accountId: options.accountId } : {}),
      ...(options.cursor ? { cursor: options.cursor } : {}),
      size: Math.max(1, Math.min(100, options.size)),
      userQuery: 'Yeosonam OS bank transaction settlement sync',
    },
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
  const toolSummaries: ClobeMcpToolSummary[] = tools.map(tool => ({
    name: tool.name,
    description: tool.description?.trim() || null,
    required: Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required : [],
    properties: Object.keys(tool.inputSchema?.properties ?? {}),
    inputFields: summarizeInputFields(tool.inputSchema),
  }));
  const preferred = getSecret('CLOBE_MCP_TRANSACTIONS_TOOL') ?? undefined;
  const rankedTools = rankTransactionTools(tools, preferred);
  const selectedToolName = chooseTransactionTool(tools, preferred);

  if (options.diagnosticsOnly) {
    return {
      transactions: [],
      toolName: selectedToolName,
      toolNames,
      attempts: [],
      bankToolAvailable: Boolean(selectedToolName),
      tools: toolSummaries,
    };
  }
  if (!selectedToolName) {
    return {
      transactions: [],
      toolName: null,
      toolNames,
      attempts: [],
      bankToolAvailable: false,
      tools: toolSummaries,
    };
  }

  const selectedTool = rankedTools[0];
  const contextTool = tools.find(tool => tool.name === 'get_my_context');
  if (!contextTool) throw new Error('Clobe MCP get_my_context tool is unavailable');

  const contextResult = await mcpCall(ctx, 'tools/call', {
    name: contextTool.name,
    arguments: { input: { userQuery: 'Yeosonam OS settlement company lookup' } },
  });
  const companyIds = resolveCompanyIds(
    contextResult,
    options.companyId || getSecret('CLOBE_COMPANY_ID') || undefined,
  );
  if (companyIds.length === 0) throw new Error('Clobe company could not be resolved from get_my_context');

  let companyId = companyIds.length === 1 ? companyIds[0] : null;
  let accountId = options.accountId ?? null;
  const accountTool = tools.find(tool => tool.name === 'get_bank_accounts');

  if (!companyId) {
    if (!options.accountNumber) {
      throw new Error('Clobe connection has multiple companies and no OS bank account could be selected');
    }
    if (!accountTool) throw new Error('Clobe MCP get_bank_accounts tool is unavailable');
    const matches: Array<{ companyId: string; accountId: string }> = [];
    for (const candidateCompanyId of companyIds) {
      const accountResult = await mcpCall(ctx, 'tools/call', {
        name: accountTool.name,
        arguments: {
          input: {
            companyId: candidateCompanyId,
            userQuery: 'Yeosonam OS settlement company bank account lookup',
          },
        },
      });
      const candidateAccountId = resolveAccountId(accountResult, options.accountNumber);
      if (candidateAccountId) matches.push({ companyId: candidateCompanyId, accountId: candidateAccountId });
    }
    if (matches.length !== 1) {
      throw new Error('Clobe company could not be uniquely matched to the OS bank account');
    }
    companyId = matches[0].companyId;
    accountId = accountId ?? matches[0].accountId;
  }

  if (!accountId && options.accountNumber) {
    if (!accountTool) throw new Error('Clobe MCP get_bank_accounts tool is unavailable');
    const accountResult = await mcpCall(ctx, 'tools/call', {
      name: accountTool.name,
      arguments: { input: { companyId, userQuery: 'Yeosonam OS settlement bank account lookup' } },
    });
    accountId = resolveAccountId(accountResult, options.accountNumber);
    if (!accountId) throw new Error('Requested Clobe bank account could not be resolved');
  }

  const attempts: ClobeMcpFetchAttempt[] = [];
  const transactions: Record<string, unknown>[] = [];
  const requestedLimit = Math.max(1, Math.min(1000, options.limit ?? 200));
  const seenCursors = new Set<string>();
  let cursor = options.cursor ?? null;

  while (transactions.length < requestedLimit) {
    const size = Math.min(100, requestedLimit - transactions.length);
    try {
      const callResult = await mcpCall(ctx, 'tools/call', {
        name: selectedTool.name,
        arguments: buildTransactionArguments({
          companyId,
          from: options.from,
          to: options.to,
          accountId: accountId ?? undefined,
          cursor: cursor ?? undefined,
          size,
        }),
      });
      const page = extractTransactionArray(callResult)
        .filter(item => typeof item === 'object' && item !== null) as Record<string, unknown>[];
      const normalizedCount = page.filter(item => normalizeClobeBankTransaction(item) != null).length;
      attempts.push({
        toolName: selectedTool.name,
        extracted: page.length,
        normalized: normalizedCount,
        ...summarizeMcpResult(callResult),
      });
      transactions.push(...page.slice(0, requestedLimit - transactions.length));

      const pagination = paginationState(callResult);
      if (!pagination.hasNext || !pagination.nextCursor || page.length === 0) break;
      if (seenCursors.has(pagination.nextCursor)) {
        throw new Error('Clobe transaction pagination returned a repeated cursor');
      }
      seenCursors.add(pagination.nextCursor);
      cursor = pagination.nextCursor;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('Clobe MCP transaction read failed');
      attempts.push({
        toolName: selectedTool.name,
        extracted: 0,
        normalized: 0,
        resultKeys: [],
        contentTypes: [],
        error: failure.message,
      });
      throw failure;
    }
  }

  return {
    transactions,
    toolName: selectedTool.name,
    toolNames,
    attempts,
    bankToolAvailable: true,
    tools: toolSummaries,
  };
}
