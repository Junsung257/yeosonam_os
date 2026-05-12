import { NextRequest, NextResponse } from 'next/server';
import { saveInquiry, saveAIResponse, getInquiries, isSupabaseConfigured, supabase } from '@/lib/supabase';
import { analyzeRecommendation, analyzeComparison, getConsultationAdvice } from '@/lib/ai-analyst';
import { AIModel } from '@/lib/ai';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: 'Supabase가 설정되지 않았습니다. 관리자에게 문의하세요.' },
      { status: 500 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const inquiryTypesRaw = searchParams.get('inquiryTypes');
    const inquiryTypes = inquiryTypesRaw
      ? inquiryTypesRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    const inquiries = await getInquiries(status || undefined, inquiryTypes);

    return NextResponse.json({
      inquiries,
      count: inquiries.length,
    });
  } catch (error) {
    console.error('Q&A 조회 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '조회에 실패했습니다.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: 'Supabase가 설정되지 않았습니다. 관리자에게 문의하세요.' },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const {
      question,
      inquiryType, // product_recommendation, price_comparison, general_consultation
      customerName,
      customerEmail,
      customerPhone,
      comparePackageIds,
      aiModel = 'gemini',
    }: {
      question: string;
      inquiryType: string;
      customerName?: string;
      customerEmail?: string;
      customerPhone?: string;
      comparePackageIds?: string[];
      aiModel?: AIModel;
    } = body;

    if (!question) {
      return NextResponse.json({ error: '질문이 필요합니다.' }, { status: 400 });
    }

    // Q&A 저장
    const inquiry = await saveInquiry({
      question,
      inquiryType,
      customerName,
      customerEmail,
      customerPhone,
    });

    if (!inquiry) {
      throw new Error('질문 저장 실패');
    }

    let responseText = '';
    let confidence = 0;
    let usedPackages: string[] = [];

    try {
      // 질문 유형별 처리
      if (inquiryType === 'price_comparison' && comparePackageIds && comparePackageIds.length > 0) {
        // 패키지 비교
        const comparison = await analyzeComparison(comparePackageIds, aiModel);
        usedPackages = comparePackageIds;
        confidence = 0.85;
        responseText = `## 패키지 비교 분석\n\n${comparison.comparison}\n\n## 우리의 추천\n${comparison.recommendation}`;
      } else if (inquiryType === 'product_recommendation') {
        // 추천 분석
        const recommendation = await analyzeRecommendation(question, aiModel);
        usedPackages = recommendation.recommendedPackages.map((p) => p.id);
        confidence = 0.8;
        responseText = `## 분석\n${recommendation.analysis}\n\n## 전문가 조언\n${recommendation.advice}`;
      } else {
        // 일반 상담
        responseText = await getConsultationAdvice(question, aiModel);
        confidence = 0.75;
      }

      // AI 응답 저장
      await saveAIResponse({
        inquiryId: inquiry.id,
        responseText,
        aiModel,
        confidence,
        usedPackages,
      });

      return NextResponse.json({
        success: true,
        inquiryId: inquiry.id,
        response: responseText,
        confidence,
      });
    } catch (aiError) {
      console.error('AI 분석 오류:', aiError);

      // AI 처리 실패해도 질문은 저장됨
      return NextResponse.json(
        {
          inquiryId: inquiry.id,
          error: 'AI 분석에 실패했습니다. 관리자가 수동으로 답변하겠습니다.',
          message: '질문이 저장되었습니다.',
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Q&A API 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '처리에 실패했습니다.' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }
  try {
    const { inquiryId, status } = await request.json();
    if (!inquiryId || !status) {
      return NextResponse.json({ error: 'inquiryId와 status가 필요합니다.' }, { status: 400 });
    }
    const { data, error } = await supabase
      .from('qa_inquiries')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', inquiryId)
      .select();
    if (error) throw error;
    return NextResponse.json({ success: true, inquiry: data?.[0] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '처리 실패' },
      { status: 500 }
    );
  }
}