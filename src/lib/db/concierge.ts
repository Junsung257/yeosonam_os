/**
 * AI 컨시어지 도메인 — Cart / Transaction / ApiOrder / MockApiConfig
 *
 * supabase.ts god 모듈에서 분리 (2026-04-27).
 * 호출자는 기존 그대로 `@/lib/supabase` 에서 import 가능 (re-export 유지).
 *
 * 사용처:
 *   - src/app/api/concierge/search/route.ts
 *   - src/app/api/concierge/checkout/route.ts
 *   - src/app/api/concierge/transactions/[id]/route.ts
 */

import { getSupabase } from '../supabase';

// ─── 타입 ────────────────────────────────────────────────────

export interface CartItem {
  product_id:       string;
  product_name:     string;
  api_name:         string;
  product_type:     'HOTEL' | 'ACTIVITY' | 'CRUISE';
  product_category: 'DYNAMIC' | 'FIXED';
  cost:             number;
  price:            number;
  quantity:         number;
  description:      string;
  attrs?:           Record<string, unknown>;
}

/** 구버전 CartItem/ApiOrder에 product_category 없을 때 api_name으로 추론 */
export function resolveProductCategory(
  item: { product_category?: string; api_name?: string }
): 'DYNAMIC' | 'FIXED' {
  if (item.product_category === 'FIXED')   return 'FIXED';
  if (item.product_category === 'DYNAMIC') return 'DYNAMIC';
  return item.api_name === 'tenant_product' ? 'FIXED' : 'DYNAMIC';
}

export interface Cart {
  id:         string;
  session_id: string;
  items:      CartItem[];
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id:               string;
  idempotency_key:  string;
  session_id:       string;
  status:           'PENDING' | 'CUSTOMER_PAID' | 'API_PROCESSING' | 'COMPLETED' | 'PARTIAL_FAIL' | 'REFUNDED';
  total_cost:       number;
  total_price:      number;
  net_margin:       number;
  customer_name?:   string;
  customer_phone?:  string;
  customer_email?:  string;
  saga_log:         SagaEvent[];
  vouchers?:        VoucherItem[];
  created_at:       string;
  updated_at:       string;
}

export interface SagaEvent {
  event:     string;
  timestamp: string;
  detail?:   string;
}

export interface VoucherItem {
  code:         string;
  product_name: string;
  product_type: string;
}

export interface ApiOrder {
  id:               string;
  transaction_id:   string;
  api_name:         string;
  product_type:     'HOTEL' | 'ACTIVITY' | 'CRUISE';
  product_category: 'DYNAMIC' | 'FIXED';
  product_id:       string;
  product_name:     string;
  cost:             number;
  price:            number;
  quantity:         number;
  status:           'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'REFUNDED';
  external_ref?:    string;
  attrs?:           Record<string, unknown>;
  created_at:       string;
}

export interface MockApiConfig {
  id:        string;
  api_name:  string;
  mode:      'success' | 'fail' | 'timeout';
  delay_ms:  number;
  updated_at: string;
}

// ── Cart ────────────────────────────────────────────────────

export async function getCart(sessionId: string): Promise<Cart | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from('carts')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  return data as Cart | null;
}

export async function upsertCart(sessionId: string, items: CartItem[]): Promise<Cart | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const existing = await getCart(sessionId);
  if (existing) {
    const { data } = await sb
      .from('carts')
      .update({ items, updated_at: new Date().toISOString() } as never)
      .eq('id', existing.id)
      .select()
      .single();
    return data as Cart | null;
  } else {
    const { data } = await sb
      .from('carts')
      .insert({ session_id: sessionId, items } as never)
      .select()
      .single();
    return data as Cart | null;
  }
}

// ── Transaction ─────────────────────────────────────────────

export async function createTransaction(data: {
  idempotency_key: string;
  session_id:      string;
  total_cost:      number;
  total_price:     number;
  customer_name?:  string;
  customer_phone?: string;
  customer_email?: string;
}): Promise<Transaction | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: row, error } = await sb
    .from('transactions')
    .insert({ ...data, status: 'PENDING', saga_log: [] } as never)
    .select()
    .single();
  if (error) {
    console.error('트랜잭션 생성 실패:', error);
    return null;
  }
  return row as Transaction;
}

export async function updateTransaction(
  id: string,
  updates: Partial<Pick<Transaction, 'status' | 'saga_log' | 'vouchers'>> & { tenant_cost_breakdown?: Record<string, number> }
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb
    .from('transactions')
    .update({ ...updates, updated_at: new Date().toISOString() } as never)
    .eq('id', id);
}

export async function getTransaction(
  id: string
): Promise<(Transaction & { api_orders: ApiOrder[] }) | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from('transactions')
    .select('*, api_orders(*)')
    .eq('id', id)
    .single();
  return data as (Transaction & { api_orders: ApiOrder[] }) | null;
}

export async function listTransactions(limit = 50): Promise<Transaction[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('transactions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as Transaction[];
}

export async function getTransactionByIdempotencyKey(
  key: string
): Promise<Transaction | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from('transactions')
    .select('*')
    .eq('idempotency_key', key)
    .single();
  return data as Transaction | null;
}

// ── ApiOrder ────────────────────────────────────────────────

export async function createApiOrder(data: {
  transaction_id:   string;
  api_name:         string;
  product_type:     'HOTEL' | 'ACTIVITY' | 'CRUISE';
  product_category: 'DYNAMIC' | 'FIXED';
  product_id:       string;
  product_name:     string;
  cost:             number;
  price:            number;
  quantity:         number;
  attrs?:           Record<string, unknown>;
}): Promise<ApiOrder | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: row, error } = await sb
    .from('api_orders')
    .insert({ ...data, status: 'PENDING' } as never)
    .select()
    .single();
  if (error) {
    console.error('api_order 생성 실패:', error);
    return null;
  }
  return row as ApiOrder;
}

export async function updateApiOrder(
  id: string,
  updates: Partial<Pick<ApiOrder, 'status' | 'external_ref'>>
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('api_orders').update(updates as never).eq('id', id);
}

export async function getApiOrdersByTransaction(transactionId: string): Promise<ApiOrder[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('api_orders')
    .select('*')
    .eq('transaction_id', transactionId)
    .order('created_at', { ascending: true });
  return (data ?? []) as ApiOrder[];
}

// ── MockApiConfig ────────────────────────────────────────────

export async function listMockConfigs(): Promise<MockApiConfig[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('mock_api_configs')
    .select('*')
    .order('api_name');
  return (data ?? []) as MockApiConfig[];
}

export async function updateMockConfig(
  apiName: string,
  updates: Partial<Pick<MockApiConfig, 'mode' | 'delay_ms'>>
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb
    .from('mock_api_configs')
    .update({ ...updates, updated_at: new Date().toISOString() } as never)
    .eq('api_name', apiName);
}
