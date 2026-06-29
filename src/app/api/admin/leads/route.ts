/**
 * 여소남 OS — 어드민 예약문의 통합 API
 *
 * GET  /api/admin/leads — leads + qa_inquiries + group_rfqs 통합 조회 (최신순)
 *
 * 두 테이블을 별도 SELECT 후 메모리 머지하여 단일 응답으로 반환.
 * 정렬: submitted_at(leads) / created_at(qa_inquiries) → 통합 created_at desc.
 */

import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export type AdminInquirySource = 'lead' | 'qa' | 'rfq';

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
    const [
      { data: leads, error: leadsErr },
      { data: qaInquiries, error: qaErr },
      { data: groupRfqs, error: rfqErr },
    ] = await Promise.all([
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
      supabaseAdmin
        .from('group_rfqs')
        .select('id, created_at, updated_at, customer_name, customer_phone, destination, departure_date_from, adult_count, child_count, budget_per_person, total_budget, special_requests, custom_requirements, status')
        .order('created_at', { ascending: false })
        .limit(500),
    ]);

    if (leadsErr) throw leadsErr;
    if (qaErr) throw qaErr;
    if (rfqErr) throw rfqErr;

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

    const rfqRows: AdminInquiryRow[] = (groupRfqs ?? []).map((q: unknown) => {
      const r = q as Record<string, unknown>;
      const cr = (r.custom_requirements ?? {}) as Record<string, unknown>;
      const utm = (cr.utm ?? {}) as Record<string, unknown>;
      const pax = Number(r.adult_count ?? 0) + Number(r.child_count ?? 0);
      const budget = r.budget_per_person
        ? `1인 ${Number(r.budget_per_person).toLocaleString('ko-KR')}원`
        : r.total_budget
          ? `총 ${Number(r.total_budget).toLocaleString('ko-KR')}원`
          : null;
      return {
        source: 'rfq',
        id: String(r.id),
        created_at: String(r.created_at ?? r.updated_at ?? ''),
        name: (r.customer_name as string) ?? null,
        phone: (r.customer_phone as string) ?? null,
        email: (cr.customer_email as string) ?? null,
        product_id: String(r.id),
        product_title: `${r.destination ?? '미정'} 단체 RFQ`,
        channel: (cr.source as string) ?? 'group_rfq',
        message: [
          r.special_requests ? String(r.special_requests) : null,
          pax > 0 ? `인원 ${pax}명` : null,
          budget,
          cr.purpose ? `목적 ${String(cr.purpose)}` : null,
        ].filter(Boolean).join(' · ') || null,
        desired_date: (r.departure_date_from as string) ?? null,
        utm_source: (utm.source as string) ?? null,
        utm_medium: (utm.medium as string) ?? null,
        utm_campaign: (utm.campaign as string) ?? null,
        landing_url: '/group',
        status: (r.status as string) ?? null,
      };
    });

    const rows = [...leadRows, ...qaRows, ...rfqRows].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    return apiResponse({ rows, total: rows.length });
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err, '조회 실패') }, { status: 500 });
  }
}

export const GET = withAdminGuard(getHandler);
