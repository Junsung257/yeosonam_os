/**
 * Q&A Inquiry — 고객 질문 + AI 응답 저장
 *
 * supabase.ts god 모듈에서 분리 (2026-04-27 단계 1).
 * 호출자는 기존 그대로 `@/lib/supabase` 에서 import 가능 (re-export 유지).
 */

import { supabase } from '../supabase';

// Q&A 저장
export async function saveInquiry(data: {
  question: string;
  inquiryType: string;
  relatedPackages?: string[];
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
}) {
  try {
    const { data: result, error } = await supabase
      .from('qa_inquiries')
      .insert([
        {
          question: data.question,
          inquiry_type: data.inquiryType,
          related_packages: data.relatedPackages || [],
          customer_name: data.customerName,
          customer_email: data.customerEmail,
          customer_phone: data.customerPhone,
          status: 'pending',
        },
      ])
      .select();

    if (error) {
      throw error;
    }

    return result?.[0];
  } catch (error) {
    console.error('문의 저장 실패:', error);
    throw error;
  }
}

// Q&A 조회
export async function getInquiries(status?: string) {
  try {
    let query = supabase
      .from('qa_inquiries')
      .select(
        `
        *,
        ai_responses (
          id,
          response_text,
          ai_model,
          created_at,
          approved
        )
      `
      )
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('문의 조회 실패:', error);
    return [];
  }
}

// AI 응답 저장
export async function saveAIResponse(data: {
  inquiryId: string;
  responseText: string;
  aiModel: string;
  confidence: number;
  usedPackages?: string[];
}) {
  try {
    const { data: result, error } = await supabase
      .from('ai_responses')
      .insert([
        {
          inquiry_id: data.inquiryId,
          response_text: data.responseText,
          ai_model: data.aiModel,
          confidence: data.confidence,
          used_packages: data.usedPackages || [],
        },
      ])
      .select();

    if (error) {
      throw error;
    }

    return result?.[0];
  } catch (error) {
    console.error('AI 응답 저장 실패:', error);
    throw error;
  }
}
