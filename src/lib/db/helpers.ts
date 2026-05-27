/**
 * 타입 안전 Supabase CRUD 헬퍼
 *
 * lib/db/ 모듈 전체의 `as never` 패턴을 제거하기 위한 공통 유틸.
 *
 * 사용법:
 *   import { insertRow, updateRow } from './helpers';
 *   const item = await insertRow(db, 'affiliates', { name: '...' });
 *
 * 주의: generated 타입(184개 테이블)의 복잡도 한계로 인해 TableName에
 *       제네릭 제약을 두지 않고 런타임에 안전하게 처리한다.
 *       대신 각 db/ 모듈 내에서 구체적인 Row 타입으로 캐스팅한다.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── 타입 안전 CRUD ───────────────────────────────────────────

/** 단일 행 삽입 → 삽입된 Row 반환 */
export async function insertRow<T>(
  db: SupabaseClient,
  table: string,
  data: Record<string, unknown>,
): Promise<T | null> {
  const { data: row, error } = await db
    .from(table)
    .insert(data)
    .select()
    .single();
  if (error) {
    console.error(`[db/helpers] ${table} insert 실패:`, error.message);
    return null;
  }
  return row as T;
}

/** 여러 행 삽입 → 배열 반환 */
export async function insertRows<T>(
  db: SupabaseClient,
  table: string,
  data: Record<string, unknown>[],
): Promise<T[]> {
  const { data: rows, error } = await db
    .from(table)
    .insert(data)
    .select();
  if (error) {
    console.error(`[db/helpers] ${table} insertRows 실패:`, error.message);
    return [];
  }
  return (rows ?? []) as T[];
}

/** ID로 업데이트 → 업데이트된 Row 반환 */
export async function updateRow<T>(
  db: SupabaseClient,
  table: string,
  id: string,
  data: Record<string, unknown>,
): Promise<T | null> {
  const { data: row, error } = await db
    .from(table)
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) {
    console.error(`[db/helpers] ${table} update 실패:`, error.message);
    return null;
  }
  return row as T;
}

/** Upsert → 결과 Row 반환 */
export async function upsertRow<T>(
  db: SupabaseClient,
  table: string,
  data: Record<string, unknown>,
  options?: { onConflict?: string },
): Promise<T | null> {
  const payload = { ...data, updated_at: new Date().toISOString() };
  const { data: row, error } = await db
    .from(table)
    .upsert(payload, options as never)
    .select()
    .single();
  if (error) {
    console.error(`[db/helpers] ${table} upsert 실패:`, error.message);
    return null;
  }
  return row as T;
}

/** ID로 단건 조회 */
export async function getRowById<T>(
  db: SupabaseClient,
  table: string,
  id: string,
): Promise<T | null> {
  const { data, error } = await db
    .from(table)
    .select('*')
    .eq('id', id)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error(`[db/helpers] ${table} getById 실패:`, error.message);
    return null;
  }
  return data as T;
}

/** 조건부 업데이트 (비-ID 기반, eq 필터) */
export async function updateRowsWhere(
  db: SupabaseClient,
  table: string,
  filters: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<void> {
  let query = db.from(table).update({ ...data, updated_at: new Date().toISOString() });
  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value);
  }
  const { error } = await query;
  if (error) {
    console.error(`[db/helpers] ${table} updateWhere 실패:`, error.message);
  }
}
