/**
 * 안심 중개 채팅 (SecureChat) & 여소남 표준 확정서 (Voucher)
 *
 * supabase.ts god 모듈에서 분리 (2026-04-27).
 * 호출자는 기존 그대로 `@/lib/supabase` 에서 import 가능 (re-export 유지).
 */

import type { VoucherData } from '../voucher-generator';
import { getSupabase } from '../supabase';

// ─── 타입 ────────────────────────────────────────────────────

export interface SecureChat {
  id: string;
  booking_id?: string | null;
  rfq_id?: string | null;
  sender_type: 'customer' | 'land_agency' | 'system';
  sender_id: string;
  receiver_type: 'customer' | 'land_agency' | 'admin';
  raw_message: string;
  masked_message: string;
  is_filtered: boolean;
  filter_detail?: string | null;
  is_unmasked: boolean;
  unmasked_at?: string | null;
  created_at: string;
}

export interface Voucher {
  id: string;
  booking_id?: string | null;
  rfq_id?: string | null;
  customer_id?: string | null;
  land_agency_id?: string | null;
  parsed_data: VoucherData;
  upsell_data: unknown[];
  pdf_url?: string | null;
  status: 'draft' | 'issued' | 'sent' | 'cancelled';
  issued_at?: string | null;
  sent_at?: string | null;
  end_date?: string | null;
  review_notified: boolean;
  created_at: string;
  updated_at: string;
}

// ── SecureChat CRUD ─────────────────────────────────────────────

export async function createSecureChat(
  data: Omit<SecureChat, 'id' | 'created_at'>
): Promise<SecureChat | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: row, error } = await sb
    .from('secure_chats')
    .insert(data as never)
    .select()
    .single();
  if (error) { console.error('createSecureChat', error); return null; }
  return row as SecureChat;
}

export async function getSecureChats(params: {
  bookingId?: string;
  rfqId?: string;
  receiverType: 'customer' | 'land_agency' | 'admin';
}): Promise<SecureChat[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb
    .from('secure_chats')
    .select('*')
    .eq('receiver_type', params.receiverType);
  if (params.bookingId) q = q.eq('booking_id', params.bookingId);
  if (params.rfqId)     q = q.eq('rfq_id', params.rfqId);
  const { data } = await q.order('created_at', { ascending: true });
  return (data ?? []) as SecureChat[];
}

/** 결제 완료 후 해당 booking의 채팅 마스킹 일괄 해제 */
export async function unmaskChatsForBooking(bookingId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb
    .from('secure_chats')
    .update({ is_unmasked: true, unmasked_at: new Date().toISOString() } as never)
    .eq('booking_id', bookingId)
    .eq('is_unmasked', false);
}

// ── Voucher CRUD ────────────────────────────────────────────────

export async function createVoucher(
  data: Omit<Voucher, 'id' | 'created_at' | 'updated_at'>
): Promise<Voucher | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: row, error } = await sb
    .from('vouchers')
    .insert({ ...data, updated_at: new Date().toISOString() } as never)
    .select()
    .single();
  if (error) { console.error('createVoucher', error); return null; }
  return row as Voucher;
}

export async function getVoucher(id: string): Promise<Voucher | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from('vouchers').select('*').eq('id', id).single();
  return data ? (data as unknown as Voucher) : null;
}

export async function getVoucherByBooking(bookingId: string): Promise<Voucher | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from('vouchers')
    .select('*')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  return data ? (data as unknown as Voucher) : null;
}

export async function updateVoucher(
  id: string,
  patch: Partial<Omit<Voucher, 'id' | 'created_at'>>
): Promise<Voucher | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from('vouchers')
    .update({ ...patch, updated_at: new Date().toISOString() } as never)
    .eq('id', id)
    .select()
    .single();
  if (error) { console.error('updateVoucher', error); return null; }
  return data as Voucher;
}

/** 여행 종료일 +1일이 지났고 만족도 조사를 아직 보내지 않은 확정서 목록 */
export async function getVouchersForReviewNotification(): Promise<Voucher[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const { data } = await sb
    .from('vouchers')
    .select('*')
    .eq('status', 'sent')
    .eq('review_notified', false)
    .lte('end_date', yesterday.toISOString().slice(0, 10));
  return (data ?? []) as Voucher[];
}
