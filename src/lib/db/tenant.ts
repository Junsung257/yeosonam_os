/**
 * SaaS Marketplace — Tenants / Inventory / Cross-Search / Ledger / Settlements
 *
 * supabase.ts god 모듈에서 분리 (2026-04-27).
 * 호출자는 기존 그대로 `@/lib/supabase` 에서 import 가능 (re-export 유지).
 */

import { getSupabase } from '../supabase';

// ─── 타입 ────────────────────────────────────────────────────

export interface Tenant {
  id:                string;
  name:              string;
  contact_name?:     string;
  contact_phone?:    string;
  contact_email?:    string;
  commission_rate:   number;
  status:            'active' | 'inactive' | 'suspended';
  description?:      string;
  tier:              'GOLD' | 'SILVER' | 'BRONZE';
  reliability_score: number;
  created_at:        string;
  updated_at:        string;
}

export interface TenantProduct {
  id:              string;
  tenant_id:       string;
  title:           string;
  destination?:    string;
  category?:       string;
  product_type?:   string;
  cost_price:      number;
  price:           number;
  min_participants?: number;
  status:          string;
  land_operator?:  string;
  notes?:          string;
  created_at:      string;
  updated_at:      string;
}

export interface InventoryBlock {
  id:              string;
  tenant_id:       string;
  product_id:      string;
  date:            string;
  total_seats:     number;
  booked_seats:    number;
  available_seats: number;
  price_override?: number;
  status:          'OPEN' | 'CLOSED' | 'SOLDOUT';
  created_at:      string;
  updated_at:      string;
}

export interface CrossSearchResult {
  product_id:   string;
  product_name: string;
  tenant_id:    string;
  tenant_name:  string;
  product_type: string;
  category?:    string;
  cost_price:   number;
  effective_price: number;
  price:        number;
  margin:       number;
  destination?: string;
  available_seats: number;
  date:         string;
  price_override?: number;
  attrs?:       Record<string, unknown>;
}

export interface LedgerEntry {
  tenant_id:        string | null;
  tenant_name:      string;
  order_count:      number;
  total_cost:       number;
  total_price:      number;
  platform_fee:     number;
  product_category: 'DYNAMIC' | 'FIXED' | 'MIXED';
}

export interface TenantSettlementRow {
  order_id:     string;
  product_name: string;
  date:         string;
  quantity:     number;
  cost:         number;
}

// ── Tenant CRUD ─────────────────────────────────────────────

export async function listTenants(): Promise<Tenant[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('tenants')
    .select('*')
    .order('name');
  return (data ?? []) as Tenant[];
}

export async function getTenant(id: string): Promise<Tenant | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from('tenants')
    .select('*')
    .eq('id', id)
    .single();
  return data as Tenant | null;
}

export async function createTenant(data: Omit<Tenant, 'id' | 'created_at' | 'updated_at'>): Promise<Tenant | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: row, error } = await sb
    .from('tenants')
    .insert(data as never)
    .select()
    .single();
  if (error) { console.error('테넌트 생성 실패:', error); return null; }
  return row as Tenant;
}

export async function updateTenant(id: string, data: Partial<Omit<Tenant, 'id' | 'created_at'>>): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('tenants').update({ ...data, updated_at: new Date().toISOString() } as never).eq('id', id);
}

// ── Tenant Products ─────────────────────────────────────────

export async function getTenantProducts(tenantId: string): Promise<TenantProduct[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('travel_packages')
    .select('id, tenant_id, title, destination, category, product_type, cost_price, price, min_participants, status, land_operator, notes, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return (data ?? []) as TenantProduct[];
}

export async function upsertTenantProduct(data: {
  id?: string;
  tenant_id: string;
  title: string;
  destination?: string;
  category?: string;
  product_type?: string;
  cost_price: number;
  price: number;
  min_participants?: number;
  notes?: string;
}): Promise<TenantProduct | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const payload = { ...data, status: 'approved', updated_at: new Date().toISOString() };
  let query;
  if (data.id) {
    query = sb.from('travel_packages').update(payload as never).eq('id', data.id).select().single();
  } else {
    query = sb.from('travel_packages').insert(payload as never).select().single();
  }
  const { data: row, error } = await query;
  if (error) { console.error('테넌트 상품 저장 실패:', error); return null; }
  return row as TenantProduct;
}

// ── Inventory Blocks ─────────────────────────────────────────

export async function getInventoryBlocks(
  productId: string,
  from: string,
  to: string
): Promise<InventoryBlock[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('inventory_blocks')
    .select('*')
    .eq('product_id', productId)
    .gte('date', from)
    .lte('date', to)
    .order('date');
  return (data ?? []) as InventoryBlock[];
}

export async function getInventoryByTenant(
  tenantId: string,
  from: string,
  to: string
): Promise<InventoryBlock[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('inventory_blocks')
    .select('*, travel_packages!product_id(title, destination, category)')
    .eq('tenant_id', tenantId)
    .gte('date', from)
    .lte('date', to)
    .order('date');
  return (data ?? []) as InventoryBlock[];
}

export async function upsertInventoryBlock(data: {
  tenant_id:      string;
  product_id:     string;
  date:           string;
  total_seats:    number;
  booked_seats?:  number;
  price_override?: number;
  status?:        'OPEN' | 'CLOSED' | 'SOLDOUT';
}): Promise<InventoryBlock | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const payload = {
    ...data,
    booked_seats: data.booked_seats ?? 0,
    status: data.status ?? 'OPEN',
    updated_at: new Date().toISOString(),
  };
  const { data: row, error } = await sb
    .from('inventory_blocks')
    .upsert(payload as never, { onConflict: 'product_id,date' })
    .select()
    .single();
  if (error) { console.error('재고 저장 실패:', error); return null; }
  return row as InventoryBlock;
}

export async function deductInventory(
  productId: string,
  date: string,
  quantity: number
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { data: current } = await sb
    .from('inventory_blocks')
    .select('booked_seats, total_seats')
    .eq('product_id', productId)
    .eq('date', date)
    .single();
  if (!current) return;
  const cur = current as unknown as { booked_seats: number; total_seats: number };

  const newBooked = cur.booked_seats + quantity;
  const isSoldOut = newBooked >= cur.total_seats;

  await sb
    .from('inventory_blocks')
    .update({
      booked_seats: newBooked,
      status: isSoldOut ? 'SOLDOUT' : 'OPEN',
      updated_at: new Date().toISOString(),
    } as never)
    .eq('product_id', productId)
    .eq('date', date);
}

// ── Cross-Tenant AI Search ───────────────────────────────────

export async function searchTenantProducts(opts: {
  destination?: string;
  category?:    string;
  date?:        string;
  persons?:     number;
}): Promise<CrossSearchResult[]> {
  const sb = getSupabase();
  if (!sb) return [];

  const minPersons = opts.persons ?? 1;

  let query = sb
    .from('inventory_blocks')
    .select(`
      id, date, available_seats, price_override, status,
      tenant_id,
      travel_packages!product_id(
        id, title, destination, category, product_type,
        cost_price, price, min_participants
      ),
      tenants!tenant_id(id, name)
    `)
    .gt('available_seats', 0)
    .eq('status', 'OPEN');

  if (opts.date) {
    query = query.eq('date', opts.date);
  } else {
    query = query.gte('date', new Date().toISOString().slice(0, 10));
  }

  const { data } = await query.limit(50);
  if (!data) return [];

  type RawRow = {
    id: string;
    date: string;
    available_seats: number;
    price_override: number | null;
    status: string;
    tenant_id: string;
    travel_packages: { id: string; title: string; destination?: string; category?: string; product_type?: string; cost_price: number; price: number; min_participants?: number } | null;
    tenants: { id: string; name: string } | null;
  };

  let results: CrossSearchResult[] = (data as RawRow[])
    .filter(row => {
      if (!row.travel_packages || !row.tenants) return false;
      if (row.available_seats < minPersons) return false;
      const pkg = row.travel_packages;
      if (opts.destination && pkg.destination) {
        const dest = opts.destination.toLowerCase();
        if (!pkg.destination.toLowerCase().includes(dest) && !pkg.title?.toLowerCase().includes(dest)) return false;
      }
      if (opts.category && pkg.category !== opts.category) return false;
      return true;
    })
    .map(row => {
      const pkg = row.travel_packages!;
      const tenant = row.tenants!;
      const effectivePrice = row.price_override ?? pkg.price;
      const margin = effectivePrice - pkg.cost_price;
      return {
        product_id:   pkg.id,
        product_name: pkg.title,
        tenant_id:    tenant.id,
        tenant_name:  tenant.name,
        product_type: pkg.category?.toUpperCase() ?? 'PACKAGE',
        category:     pkg.category,
        cost_price:   pkg.cost_price,
        effective_price: effectivePrice,
        price:        effectivePrice,
        margin,
        destination:  pkg.destination,
        available_seats: row.available_seats,
        date:         row.date,
        price_override: row.price_override ?? undefined,
        attrs: { category: pkg.category, min_participants: pkg.min_participants },
      };
    });

  results = results.sort((a, b) => b.margin - a.margin);
  return results;
}

// ── Master Ledger ────────────────────────────────────────────

export async function getMasterLedger(month: string, category?: 'DYNAMIC' | 'FIXED'): Promise<{
  entries: LedgerEntry[];
  kpis: { total_price: number; total_cost: number; platform_fee: number; tx_count: number; dynamic_price: number; fixed_price: number };
}> {
  const sb = getSupabase();
  const emptyKpis = { total_price: 0, total_cost: 0, platform_fee: 0, tx_count: 0, dynamic_price: 0, fixed_price: 0 };
  if (!sb) return { entries: [], kpis: emptyKpis };

  const [y, m] = month.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${lastDay}T23:59:59Z`;

  const { data: orders } = await sb
    .from('api_orders')
    .select(`
      id, api_name, product_category, cost, price, quantity, tenant_id,
      transactions!transaction_id(id, status, created_at),
      tenants!tenant_id(id, name)
    `)
    .gte('created_at', from)
    .lte('created_at', to);

  if (!orders) return { entries: [], kpis: emptyKpis };

  type OrderRow = {
    api_name: string; product_category: string | null;
    cost: number; price: number; quantity: number; tenant_id: string | null;
    transactions: { status: string; created_at: string } | null;
    tenants: { id: string; name: string } | null;
  };

  const allCompleted = (orders as OrderRow[]).filter(o => o.transactions?.status === 'COMPLETED');

  const resolveCategory = (o: OrderRow): 'DYNAMIC' | 'FIXED' => {
    if (o.product_category === 'FIXED')   return 'FIXED';
    if (o.product_category === 'DYNAMIC') return 'DYNAMIC';
    return o.api_name === 'tenant_product' ? 'FIXED' : 'DYNAMIC';
  };

  const completed = category
    ? allCompleted.filter(o => resolveCategory(o) === category)
    : allCompleted;

  const map = new Map<string, LedgerEntry>();

  for (const o of completed) {
    const key  = o.tenant_id ?? 'mock';
    const name = o.tenants?.name ?? 'Mock API (자체 상품)';
    const cat  = resolveCategory(o);
    if (!map.has(key)) {
      map.set(key, { tenant_id: o.tenant_id, tenant_name: name, order_count: 0, total_cost: 0, total_price: 0, platform_fee: 0, product_category: cat });
    }
    const entry = map.get(key)!;
    entry.order_count += 1;
    entry.total_cost  += o.cost  * o.quantity;
    entry.total_price += o.price * o.quantity;
    if (entry.product_category !== cat) entry.product_category = 'MIXED';
  }

  const entries = Array.from(map.values()).map(e => ({
    ...e,
    platform_fee: e.total_price - e.total_cost,
  })).sort((a, b) => b.total_cost - a.total_cost);

  let dynamic_price = 0, fixed_price = 0;
  for (const o of allCompleted) {
    const v = o.price * o.quantity;
    if (resolveCategory(o) === 'FIXED') fixed_price += v; else dynamic_price += v;
  }

  const kpis = entries.reduce(
    (s, e) => ({
      total_price:  s.total_price  + e.total_price,
      total_cost:   s.total_cost   + e.total_cost,
      platform_fee: s.platform_fee + e.platform_fee,
      tx_count:     s.tx_count     + e.order_count,
      dynamic_price,
      fixed_price,
    }),
    { total_price: 0, total_cost: 0, platform_fee: 0, tx_count: 0, dynamic_price, fixed_price }
  );

  return { entries, kpis };
}

// ── Tenant Settlements ───────────────────────────────────────

export async function getTenantSettlements(
  tenantId: string,
  month: string
): Promise<{ rows: TenantSettlementRow[]; total_cost: number }> {
  const sb = getSupabase();
  if (!sb) return { rows: [], total_cost: 0 };

  const [y, m] = month.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${lastDay}T23:59:59Z`;

  const { data } = await sb
    .from('api_orders')
    .select('id, product_name, created_at, quantity, cost, transactions!transaction_id(status)')
    .eq('tenant_id', tenantId)
    .gte('created_at', from)
    .lte('created_at', to);

  if (!data) return { rows: [], total_cost: 0 };

  type Row = { id: string; product_name: string; created_at: string; quantity: number; cost: number; transactions: { status: string } | null };

  const rows: TenantSettlementRow[] = (data as Row[])
    .filter(o => o.transactions?.status === 'COMPLETED')
    .map(o => ({
      order_id:     o.id,
      product_name: o.product_name,
      date:         o.created_at.slice(0, 10),
      quantity:     o.quantity,
      cost:         o.cost * o.quantity,
    }));

  const total_cost = rows.reduce((s, r) => s + r.cost, 0);
  return { rows, total_cost };
}

// ── Tenant 신뢰도 점수 ───────────────────────────────────────

export async function updateTenantReliability(tenantId: string, delta: number): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  // reliability_score = GREATEST(0, LEAST(100, current + delta))
  const { data: t } = await sb.from('tenants').select('reliability_score').eq('id', tenantId).single();
  if (!t) return;
  const newScore = Math.max(0, Math.min(100, (t as { reliability_score: number }).reliability_score + delta));
  await sb.from('tenants').update({ reliability_score: newScore } as never).eq('id', tenantId);
}
