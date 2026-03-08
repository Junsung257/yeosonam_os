import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn('Supabase 환경변수가 설정되지 않았습니다.');
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// 여행 상품 저장
export async function saveTravelPackage(data: {
  title: string;
  destination?: string;
  duration?: number;
  price?: number;
  filename: string;
  fileType: 'pdf' | 'image' | 'hwp';
  rawText: string;
  itinerary?: string[];
  inclusions?: string[];
  excludes?: string[];
  accommodations?: string[];
  specialNotes?: string;
  confidence: number;
}) {
  try {
    const { data: result, error } = await supabase
      .from('travel_packages')
      .insert([
        {
          title: data.title,
          destination: data.destination,
          duration: data.duration,
          price: data.price,
          filename: data.filename,
          file_type: data.fileType,
          raw_text: data.rawText,
          itinerary: data.itinerary || [],
          inclusions: data.inclusions || [],
          excludes: data.excludes || [],
          accommodations: data.accommodations || [],
          special_notes: data.specialNotes,
          confidence: data.confidence,
          status: 'pending',
        },
      ])
      .select();

    if (error) {
      throw error;
    }

    return result?.[0];
  } catch (error) {
    console.error('여행 상품 저장 실패:', error);
    throw new Error(
      `여행 상품 저장 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`
    );
  }
}

// 여행 상품 조회 (승인된 것만)
export async function getApprovedPackages(destination?: string) {
  try {
    let query = supabase
      .from('travel_packages')
      .select('*')
      .eq('status', 'approved')
      .order('created_at', { ascending: false });

    if (destination) {
      query = query.ilike('destination', `%${destination}%`);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('여행 상품 조회 실패:', error);
    return [];
  }
}

// 승인 대기 중인 상품 조회
export async function getPendingPackages() {
  try {
    const { data, error } = await supabase
      .from('travel_packages')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('승인 대기 상품 조회 실패:', error);
    return [];
  }
}

// 특정 상품 승인
export async function approvePackage(packageId: string) {
  try {
    const { data, error } = await supabase
      .from('travel_packages')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', packageId)
      .select();

    if (error) {
      throw error;
    }

    return data?.[0];
  } catch (error) {
    console.error('상품 승인 실패:', error);
    throw error;
  }
}

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

// 마진 계산
export async function calculateMargin(packageId: string, customerType: 'vip' | 'regular' | 'bulk') {
  try {
    const { data: marginData, error: marginError } = await supabase
      .from('margin_settings')
      .select('*')
      .eq('package_id', packageId)
      .single();

    if (marginError) {
      console.warn('마진 설정 없음:', marginError);
      return null;
    }

    const { data: packageData, error: packageError } = await supabase
      .from('travel_packages')
      .select('price')
      .eq('id', packageId)
      .single();

    if (packageError || !packageData) {
      throw packageError;
    }

    const marginPercent =
      customerType === 'vip'
        ? marginData.vip_margin_percent
        : customerType === 'bulk'
          ? marginData.bulk_margin_percent
          : marginData.regular_margin_percent;

    const marginAmount = (packageData.price * marginPercent) / 100;
    const sellingPrice = packageData.price + marginAmount;

    return {
      basePrice: packageData.price,
      marginPercent,
      marginAmount: Math.round(marginAmount),
      sellingPrice: Math.round(sellingPrice),
    };
  } catch (error) {
    console.error('마진 계산 실패:', error);
    throw error;
  }
}