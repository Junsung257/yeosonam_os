import { NextRequest, NextResponse } from 'next/server';
import { parseDocument, ParsedDocument } from '@/lib/parser';
import { saveTravelPackage } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: '파일이 업로드되지 않았습니다.' },
        { status: 400 }
      );
    }

    // 파일 크기 확인 (최대 10MB)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: '파일 크기는 10MB 이하여야 합니다.' },
        { status: 400 }
      );
    }

    // 지원하는 파일 형식 확인
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'application/x-hwp'];
    const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp'];
    
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      return NextResponse.json(
        { error: `지원하지 않는 파일 형식입니다. (${allowedExtensions.join(', ')})` },
        { status: 400 }
      );
    }

    // 파일을 Buffer로 변환
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 문서 파싱
    const parsedDocument = await parseDocument(buffer, file.name);

    // Supabase에 저장 (선택사항)
    let savedToDb = null;
    try {
      savedToDb = await saveTravelPackage({
        title: parsedDocument.extractedData.title || file.name,
        destination: parsedDocument.extractedData.destination,
        duration: parsedDocument.extractedData.duration,
        price: parsedDocument.extractedData.price,
        filename: file.name,
        fileType: parsedDocument.fileType,
        rawText: parsedDocument.rawText,
        itinerary: parsedDocument.extractedData.itinerary,
        inclusions: parsedDocument.extractedData.inclusions,
        excludes: parsedDocument.extractedData.excludes,
        accommodations: parsedDocument.extractedData.accommodations,
        specialNotes: parsedDocument.extractedData.specialNotes,
        confidence: parsedDocument.confidence,
      });
    } catch (dbError) {
      console.warn('DB 저장 실패 (비취소 오류):', dbError);
      // DB 저장 실패해도 파싱 결과는 반환
    }

    return NextResponse.json({
      success: true,
      data: parsedDocument,
      dbId: savedToDb?.id,
      message: '문서가 성공적으로 파싱되었습니다.',
    });
  } catch (error) {
    console.error('파일 업로드 오류:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : '파일 처리에 실패했습니다.',
      },
      { status: 500 }
    );
  }
}