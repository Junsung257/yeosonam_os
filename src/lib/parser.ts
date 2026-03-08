import pdfParse from 'pdf-parse';
import Tesseract from 'tesseract.js';
import { Buffer } from 'buffer';

// 파싱된 문서 데이터 구조
export interface ParsedDocument {
  filename: string;
  fileType: 'pdf' | 'image' | 'hwp';
  rawText: string;
  extractedData: {
    title?: string;
    destination?: string;
    duration?: number;
    price?: number;
    itinerary?: string[];
    inclusions?: string[];
    excludes?: string[];
    accommodations?: string[];
    specialNotes?: string;
    rawText: string;
  };
  parsedAt: Date;
  confidence: number; // 0-1 사이 값
}

// PDF 파싱
export async function parsePDF(buffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(buffer);
    return data.text || '';
  } catch (error) {
    throw new Error(`PDF 파싱 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
  }
}

// 이미지(JPG/PNG) OCR 파싱
export async function parseImage(buffer: Buffer): Promise<string> {
  try {
    const result = await Tesseract.recognize(buffer, 'kor', {
      logger: (m) => console.log('OCR 진행:', Math.round(m.progress * 100) + '%'),
    });
    return result.data.text || '';
  } catch (error) {
    throw new Error(`OCR 파싱 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
  }
}

// HWP 파싱 (stub - 실제로는 libreoffice CLI 사용 필요)
export async function parseHWP(buffer: Buffer): Promise<string> {
  try {
    // TODO: LibreOffice CLI를 사용한 실제 HWP 파싱
    // 임시로 버퍼를 텍스트로 변환 (제대로 된 구현 필요)
    const text = buffer.toString('utf-8', 0, Math.min(10000, buffer.length));
    return text;
  } catch (error) {
    throw new Error(`HWP 파싱 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
  }
}

// 텍스트에서 핵심 정보 추출
export function extractTravelInfo(text: string): ParsedDocument['extractedData'] {
  const data: ParsedDocument['extractedData'] = {
    rawText: text,
    itinerary: [],
    inclusions: [],
    excludes: [],
    accommodations: [],
  };

  // 제목 추출 (첫 번째 줄 또는 큰 텍스트)
  const titleMatch = text.match(/^([^\n]{5,100})/m);
  if (titleMatch) {
    data.title = titleMatch[1].trim();
  }

  // 여행지 추출
  const destMatch = text.match(
    /(목적지|여행지|도시|지역|장소)[\s:]*([^,\n]+)/i
  );
  if (destMatch) {
    data.destination = destMatch[2].trim();
  }

  // 기간 추출 (예: "3박 4일", "4일간")
  const durationMatch = text.match(/(\d+)\s*박\s*(\d+)\s*일|(\d+)\s*일간?/i);
  if (durationMatch) {
    const days = durationMatch[2] || durationMatch[3];
    data.duration = parseInt(days);
  }

  // 가격 추출 (예: "450,000원", "450000원")
  const priceMatch = text.match(/([0-9,]+)\s*원/);
  if (priceMatch) {
    const priceStr = priceMatch[1].replace(/,/g, '');
    data.price = parseInt(priceStr);
  }

  // 일정 추출 (Day/날짜로 시작하는 라인들)
  const itineraryMatches = text.match(/(?:Day\s*\d+|Day \d+|첫.{0,2}날|둘.{0,2}날|셋.{0,2}날)[\s:]*([^\n]+)/gi);
  if (itineraryMatches) {
    data.itinerary = itineraryMatches.map(match => match.replace(/^Day\s*\d+[\s:]*|^Day \d+[\s:]*/, '').trim());
  }

  // 포함 사항 추출
  const inclusionsSection = text.match(/포함.*?(?=불포함|제외|[^\n]*:[\s\n]|$)/is);
  if (inclusionsSection) {
    const matches = inclusionsSection[0].match(/[•\-•·★]/g);
    if (matches) {
      data.inclusions = inclusionsSection[0]
        .split(/[•\-•·★]/)
        .filter(line => line.trim().length > 0)
        .map(line => line.trim());
    }
  }

  // 불포함 사항 추출
  const excludesSection = text.match(/(?:불포함|제외).*?(?=[^•\-•·★\s]|$)/is);
  if (excludesSection) {
    data.excludes = excludesSection[0]
      .split(/[•\-•·★]/)
      .filter(line => line.trim().length > 0)
      .map(line => line.trim());
  }

  // 숙박 정보 추출
  const accommodationMatch = text.match(/숙박[\s:]*([^\n]+(?:\n(?:^(?![\s]*\n))[^\n]+)*)/is);
  if (accommodationMatch) {
    data.accommodations = accommodationMatch[1]
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => line.trim());
  }

  // 특별 안내 추출
  const notesMatch = text.match(/(?:특별|안내|주의|유의)[\s:]*([^\n]+)/i);
  if (notesMatch) {
    data.specialNotes = notesMatch[1].trim();
  }

  return data;
}

// 메인 문서 파싱 함수
export async function parseDocument(
  buffer: Buffer,
  filename: string
): Promise<ParsedDocument> {
  const ext = filename.split('.').pop()?.toLowerCase();
  let rawText = '';
  let fileType: 'pdf' | 'image' | 'hwp' = 'pdf';

  try {
    switch (ext) {
      case 'pdf':
        fileType = 'pdf';
        rawText = await parsePDF(buffer);
        break;
      case 'jpg':
      case 'jpeg':
      case 'png':
        fileType = 'image';
        rawText = await parseImage(buffer);
        break;
      case 'hwp':
        fileType = 'hwp';
        rawText = await parseHWP(buffer);
        break;
      default:
        throw new Error(`지원하지 않는 파일 형식: ${ext}`);
    }

    if (!rawText) {
      throw new Error('파일에서 텍스트를 추출할 수 없습니다.');
    }

    const extractedData = extractTravelInfo(rawText);

    return {
      filename,
      fileType,
      rawText,
      extractedData,
      parsedAt: new Date(),
      confidence: calculateConfidence(extractedData),
    };
  } catch (error) {
    throw new Error(
      `문서 파싱 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`
    );
  }
}

// 추출 신뢰도 계산 (0-1)
function calculateConfidence(data: ParsedDocument['extractedData']): number {
  let score = 0;
  let totalChecks = 0;

  if (data.title) score += 15;
  totalChecks += 15;

  if (data.destination) score += 20;
  totalChecks += 20;

  if (data.duration) score += 15;
  totalChecks += 15;

  if (data.price) score += 25;
  totalChecks += 25;

  if (data.itinerary && data.itinerary.length > 0) score += 15;
  totalChecks += 15;

  if (data.inclusions && data.inclusions.length > 0) score += 10;
  totalChecks += 10;

  return totalChecks > 0 ? score / totalChecks : 0;
}