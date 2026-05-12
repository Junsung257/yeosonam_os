/**
 * Card News CRUD
 *
 * supabase.ts god 모듈에서 분리 (2026-04-27).
 * 호출자는 기존 그대로 `@/lib/supabase` 에서 import 가능 (re-export 유지).
 */

import { getSupabaseAdmin } from '../supabase';

// ─── 타입 ────────────────────────────────────────────────────

export interface TextStyle {
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  fontWeight?: 'normal' | 'bold';
  textAlign?: 'left' | 'center' | 'right';
}

export interface CardNewsSlide {
  id: string;
  position: number;
  headline: string;
  body: string;
  bg_image_url: string;
  pexels_keyword: string;
  overlay_style: 'dark' | 'light' | 'gradient-bottom' | 'gradient-top';
  headline_style?: TextStyle;
  body_style?: TextStyle;
  // V1 디자인 시스템
  template_id?: string;
  role?: string;
  badge?: string | null;
  brief_section_position?: number;
  // V2 슬롯 (Atom 기반 템플릿에서 사용)
  template_family?: 'editorial' | 'cinematic' | 'premium' | 'bold';
  template_version?: string;
  eyebrow?: string | null;
  tip?: string | null;
  warning?: string | null;
  price_chip?: string | null;
  trust_row?: string[] | null;
  accent_color?: string | null;
  photo_hint?: string | null;
}

export interface CardNews {
  id: string;
  package_id: string | null;
  campaign_id: string | null;
  title: string;
  status: 'DRAFT' | 'CONFIRMED' | 'LAUNCHED' | 'ARCHIVED';
  slides: CardNewsSlide[];
  meta_creative_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // 조인 필드
  package_title?: string;
  package_destination?: string;
  // 블로그 생성 시 업로드된 슬라이드 PNG URL (from-card-news 라우트가 저장)
  slide_image_urls?: string[] | null;
  linked_blog_id?: string | null;
  // 인스타그램 자동 발행 (20260414130000 migration)
  ig_post_id?: string | null;
  ig_published_at?: string | null;
  ig_scheduled_for?: string | null;
  ig_publish_status?: 'queued' | 'publishing' | 'published' | 'failed' | null;
  ig_caption?: string | null;
  ig_error?: string | null;
  ig_slide_urls?: string[] | null;
  // V2 컬럼 (20260423010000 migration)
  template_family?: 'editorial' | 'cinematic' | 'premium' | 'bold' | 'html' | null;
  template_version?: string | null;
  brand_kit_id?: string | null;
  // brief 스냅샷 (LLM ContentBrief V2 원본)
  generation_config?: { brief?: unknown; html_mode?: unknown } | null;
  // 기타 메타
  card_news_type?: 'product' | 'info';
  topic?: string | null;
  category_id?: string | null;
  // HTML 모드 (20260427100000 migration · Claude Sonnet 4.6 + Puppeteer)
  html_raw?: string | null;
  html_generated?: string | null;
  html_thinking?: string | null;
  html_usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    costUsd?: number;
    model?: string;
    durationMs?: number;
    generatedAt?: string;
  } | null;
}

// ─── CRUD ────────────────────────────────────────────────────

export async function getCardNewsList(filters?: {
  status?: string;
  packageId?: string;
  limit?: number;
}): Promise<CardNews[]> {
  const admin = getSupabaseAdmin();
  if (!admin) return [];

  let query = admin
    .from('card_news')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.packageId) query = query.eq('package_id', filters.packageId);
  if (filters?.limit) query = query.limit(filters.limit);

  const { data, error } = await query;
  if (error) { console.error('getCardNewsList error:', error.message); return []; }
  return (data ?? []) as unknown as CardNews[];
}

export async function getCardNewsById(id: string): Promise<CardNews | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { data, error } = await admin
    .from('card_news')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return null;
  return data as unknown as CardNews;
}

export async function upsertCardNews(
  data: Partial<CardNews> & { title: string }
): Promise<CardNews | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { data: result, error } = await admin
    .from('card_news')
    .upsert({ ...data, updated_at: new Date().toISOString() } as never)
    .select()
    .single();

  if (error) throw new Error(`카드뉴스 저장 실패: ${error.message}`);
  return result as unknown as CardNews;
}
