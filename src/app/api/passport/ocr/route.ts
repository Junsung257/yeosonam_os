/**
 * Phase 3-G: 여권 OCR API
 * POST /api/passport/ocr
 *
 * multipart/form-data: file (여권 이미지)
 * → Gemini Vision으로 여권 정보 파싱
 * → { surname, given_name, passport_no, nationality, birth_date, expiry_date, gender, mrz_line1, mrz_line2 }
 *
 * Stateless — DB 저장 없음.
 */

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 허용 MIME 타입
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic'];

interface PassportData {
  surname: string | null;
  given_name: string | null;
  passport_no: string | null;
  nationality: string | null;
  birth_date: string | null;   // YYYY-MM-DD
  expiry_date: string | null;  // YYYY-MM-DD
  gender: string | null;       // 'M' | 'F' | '<'
  mrz_line1: string | null;
  mrz_line2: string | null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY 미설정' }, { status: 503 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'file 필드 필수' }, { status: 400 });
    }

    const mimeType = file.type || 'image/jpeg';
    if (!ALLOWED_MIME.includes(mimeType)) {
      return NextResponse.json(
        { error: `지원하지 않는 파일 형식: ${mimeType}. JPEG/PNG/WEBP 사용` },
        { status: 400 },
      );
    }

    // 파일 크기 제한 10MB
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: '파일 크기 10MB 초과' }, { status: 400 });
    }

    // 파일을 Base64로 변환
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `이 여권 이미지에서 다음 정보를 추출하여 JSON으로만 응답하세요. 설명 없이 JSON만 반환하세요.

{
  "surname": "성 (한글 또는 영문)",
  "given_name": "이름 (한글 또는 영문)",
  "passport_no": "여권 번호 (예: M12345678)",
  "nationality": "국적 코드 (예: KOR, CHN, USA)",
  "birth_date": "생년월일 YYYY-MM-DD 형식",
  "expiry_date": "만료일 YYYY-MM-DD 형식",
  "gender": "성별 M 또는 F",
  "mrz_line1": "MRZ 첫째 줄 (기계 판독 영역 전체)",
  "mrz_line2": "MRZ 둘째 줄"
}

읽을 수 없는 필드는 null로 표시. 날짜는 반드시 YYYY-MM-DD 형식. MRZ의 날짜는 YYMMDD → YYYY-MM-DD 변환.`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64,
        },
      },
    ]);

    const text = result.response.text().trim();

    // JSON 추출
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: '여권 정보를 인식할 수 없습니다. 더 선명한 이미지를 사용하세요.' },
        { status: 422 },
      );
    }

    const parsed = JSON.parse(jsonMatch[0]) as PassportData;

    // 기본값 정규화
    const result_data: PassportData = {
      surname: parsed.surname ?? null,
      given_name: parsed.given_name ?? null,
      passport_no: parsed.passport_no ?? null,
      nationality: parsed.nationality ?? null,
      birth_date: parsed.birth_date ?? null,
      expiry_date: parsed.expiry_date ?? null,
      gender: parsed.gender ?? null,
      mrz_line1: parsed.mrz_line1 ?? null,
      mrz_line2: parsed.mrz_line2 ?? null,
    };

    return NextResponse.json({ ok: true, data: result_data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OCR 처리 실패';
    console.error('[passport/ocr] 오류:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
