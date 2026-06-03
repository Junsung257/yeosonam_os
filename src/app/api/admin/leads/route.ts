/**
 * 여소남 OS — 어드민 예약문의 통합 API
 *
 * GET  /api/admin/leads — leads + qa_inquiries 통합 조회 (최신순)
 *
 * 두 테이블을 별도 SELECT 후 메모리 머지하여 단일 응답으로 반환.
 * 정렬: submitted_at(leads) / created_at(qa_inquiries) → 통합 created_at desc.
 */

import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export type AdminInquirySource = 'lead' | 'qa';

export interface AdminInquiryRow {
  source: AdminInquirySource;
  id: string;
  created_at: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  product_id: string | null;
  product_title: string | null;
  channel: string | null;
  message: string | null;
  desired_date: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  landing_url: string | null;
  status: string | null;
}

async function getHandler() {
  if (!isSupabaseConfigured) {
    return apiResponse({ rows: [], total: 0 });
  }
  try {
    const [{ data: leads, error: leadsErr }, { data: qaInquiries, error: qaErr }] = await Promise.all([
      supabaseAdmin
        .from('leads')
        .select('id, submitted_at, created_at, name, phone, product_id, channel, desired_date, utm_source, utm_medium, utm_campaign, landing_url, travel_packages:product_id(title)')
        .order('submitted_at', { ascending: false })
        .limit(500),
      supabaseAdmin
        .from('qa_inquiries')
        .select('id, created_at, customer_name, customer_phone, customer_email, question, inquiry_type, status, related_packages')
        .order('created_at', { ascending: false })
        .limit(500),
    ]);

    if (leadsErr) throw leadsErr;
    if (qaErr) throw qaErr;

    const leadRows: AdminInquiryRow[] = (leads ?? []).map((l: unknown) => {
      const r = l as Record<string, unknown>;
      const pkg = r.travel_packages as { title?: string } | null;
      return {
        source: 'lead',
        id: String(r.id),
        created_at: String(r.submitted_at ?? r.created_at ?? ''),
        name: (r.name as string) ?? null,
        phone: (r.phone as string) ?? null,
        email: null,
        product_id: (r.product_id as string) ?? null,
        product_title: pkg?.title ?? null,
        channel: (r.channel as string) ?? null,
        message: null,
        desired_date: (r.desired_date as string) ?? null,
        utm_source: (r.utm_source as string) ?? null,
        utm_medium: (r.utm_medium as string) ?? null,
        utm_campaign: (r.utm_campaign as string) ?? null,
        landing_url: (r.landing_url as string) ?? null,
        status: null,
      };
    });

    const qaRows: AdminInquiryRow[] = (qaInquiries ?? []).map((q: unknown) => {
      const r = q as Record<string, unknown>;
      return {
        source: 'qa',
        id: String(r.id),
        created_at: String(r.created_at ?? ''),
        name: (r.customer_name as string) ?? null,
        phone: (r.customer_phone as string) ?? null,
        email: (r.customer_email as string) ?? null,
        product_id: null,
        product_title: null,
        channel: (r.inquiry_type as string) ?? null,
        message: (r.question as string) ?? null,
        desired_date: null,
        utm_source: null,
        utm_medium: null,
        utm_campaign: null,
        landing_url: null,
        status: (r.status as string) ?? null,
      };
    });

    const rows = [...leadRows, ...qaRows].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    return apiResponse({ rows, total: rows.length });
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err, '조회 실패') }, { status: 500 });
  }
}

export const GET = withAdminGuard(getHandler);
