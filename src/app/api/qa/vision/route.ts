import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { applyMarkup } from '@/lib/price-dates';

export const maxDuration = 60;

// 경쟁사 견적서 이미지 → Vision AI 분석 → 여소남 패키지 방어 영업
export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY 미설정' }, { status: 500 });
  }

  try {
    const formData = await request.formData();
    const imageFile = formData.get('image') as File | null;
    const userMessage = (formData.get('message') as string | null) ?? '';

    if (!imageFile) {
      return NextResponse.json({ error: '이미지 파일이 필요합니다' }, { status: 400 });
    }

    const imageBytes = await imageFile.arrayBuffer();
    const base64Image = Buffer.from(imageBytes).toString('base64');
    const mimeType = (imageFile.type || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp';

    // 1. Gemini Vision으로 견적서 파싱
    const gemini = new GoogleGenerativeAI(apiKey);
    const model = gemini.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const extractPrompt = `이 이미지는 여행사의 패키지 견적서 또는 상품 소개입니다.
다음 정보를 JSON으로 추출하세요. 없으면 null:
{
  "destination": "여행지 (한국어, 예: 다낭)",
  "duration": "기간 (예: 4박5일)",
  "departure_date": "출발일 (YYYY-MM-DD 또는 null)",
  "price_per_person": "1인 가격 (숫자만, 원화 기준)",
  "includes": ["포함 항목 목록"],
  "hotel_grade": "호텔 등급 (예: 4성급 또는 null)",
  "airline": "항공사 (예: 베트남항공 또는 null)",
  "company_name": "여행사명 (예: 하나투어)",
  "key_features": ["특장점 목록 (최대 3개)"]
}
JSON만 출력하세요. 마크다운 코드블록 없이.`;

    const extractResult = await model.generateContent([
      extractPrompt,
      { inlineData: { data: base64Image, mimeType } },
    ]);

    let quoteData: Record<string, unknown> = {};
    try {
      const raw = extractResult.response.text().trim();
      quoteData = JSON.parse(raw.replace(/```json?|```/g, '').trim());
    } catch {
      quoteData = { destination: null, price_per_person: null };
    }

    const destination = (quoteData.destination as string | null) ?? '';
    const competitorPrice = quoteData.price_per_person as number | null;

    // 2. 해당 destination의 여소남 패키지 조회
    let ourPackages: Array<{
      id: string;
      title: string;
      destination: string;
      price_dates: Array<{ price: number }> | null;
      price_markup_rate: number;
      duration: number;
    }> = [];

    if (destination && isSupabaseConfigured) {
      const { data } = await supabaseAdmin
        .from('travel_packages')
        .select('id, title, destination, price_dates, price_markup_rate, duration')
        .eq('status', 'approved')
        .ilike('destination', `%${destination}%`)
        .limit(5);
      ourPackages = (data ?? []) as typeof ourPackages;
    }

    // 3. 최저가 + 마크업 적용가 계산
    const enriched = ourPackages.map((pkg) => {
      const prices = (pkg.price_dates ?? []).map((pd) => pd.price).filter(Boolean);
      const minPrice = prices.length ? Math.min(...prices) : null;
      const displayPrice =
        minPrice != null
          ? applyMarkup(minPrice, pkg.price_markup_rate ?? 0)
          : null;
      return { ...pkg, minPrice, displayPrice };
    });

    const cheapestOurs = enriched
      .filter((p) => p.displayPrice != null)
      .sort((a, b) => (a.displayPrice ?? 0) - (b.displayPrice ?? 0));

    // 4. Gemini로 방어 영업 응답 생성
    const ourBest = cheapestOurs[0];
    const priceDiff =
      competitorPrice != null && ourBest?.displayPrice != null
        ? competitorPrice - ourBest.displayPrice
        : null;

    const salesPrompt = `당신은 여소남 여행사의 친절한 상담사입니다.
고객이 다른 여행사의 견적서 이미지를 보내왔습니다.

경쟁사 견적 분석:
${JSON.stringify(quoteData, null, 2)}

여소남 최저가 상품:
${ourBest ? JSON.stringify({ title: ourBest.title, displayPrice: ourBest.displayPrice, duration: ourBest.duration }, null, 2) : '(현재 일치하는 상품 없음)'}

가격차이: ${priceDiff != null ? (priceDiff > 0 ? `여소남이 ${priceDiff.toLocaleString()}원 더 저렴` : `경쟁사가 ${Math.abs(priceDiff).toLocaleString()}원 더 저렴`) : '비교 불가'}

${userMessage ? `고객 메시지: ${userMessage}` : ''}

2-3문장으로 간결하게 방어 영업 멘트를 작성하세요:
- 가격 비교 내용 포함
- 여소남만의 강점 1가지 언급 (노팁노옵션, 소그룹 등)
- 친근하고 신뢰감 있는 톤
- "여소남" 브랜드명 사용`;

    const salesResult = await model.generateContent(salesPrompt);
    const salesReply = salesResult.response.text().trim();

    return NextResponse.json({
      quote: quoteData,
      ourOptions: cheapestOurs.slice(0, 3).map((p) => ({
        id: p.id,
        title: p.title,
        displayPrice: p.displayPrice,
        duration: p.duration,
      })),
      priceDiff,
      reply: salesReply,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
