import { NextRequest, NextResponse } from 'next/server';
import { parseDocument, ParsedDocument } from '@/lib/parser';

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

    return NextResponse.json({
      success: true,
      data: parsedDocument,
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