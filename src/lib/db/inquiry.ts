import { isSupabaseAdminConfigured, supabase, supabaseAdmin } from '../supabase';

type InquiryInsert = {
  question: string;
  inquiry_type: string;
  related_packages: string[];
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  status: 'pending';
};

export async function saveInquiry(data: {
  question: string;
  inquiryType: string;
  relatedPackages?: string[];
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
}) {
  if (!isSupabaseAdminConfigured) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to save customer inquiries');
  }

  const row: InquiryInsert = {
    question: data.question.slice(0, 5000),
    inquiry_type: (data.inquiryType || 'general_consultation').slice(0, 80),
    related_packages: data.relatedPackages || [],
    customer_name: data.customerName?.slice(0, 120),
    customer_email: data.customerEmail?.slice(0, 240),
    customer_phone: data.customerPhone?.slice(0, 80),
    status: 'pending',
  };

  const { data: result, error } = await supabaseAdmin
    .from('qa_inquiries')
    .insert([row])
    .select();

  if (error) {
    console.error('Inquiry save failed:', error);
    throw error;
  }

  return result?.[0];
}

export async function getInquiries(status?: string, inquiryTypes?: string[]) {
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
      `,
      )
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const types = (inquiryTypes ?? []).map((t) => t.trim()).filter(Boolean);
    if (types.length > 0) {
      query = query.in('inquiry_type', types);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Inquiry list failed:', error);
    return [];
  }
}

export async function saveAIResponse(data: {
  inquiryId: string;
  responseText: string;
  aiModel: string;
  confidence: number;
  usedPackages?: string[];
}) {
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
    console.error('AI response save failed:', error);
    throw error;
  }

  return result?.[0];
}
