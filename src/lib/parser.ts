import pdfParse from 'pdf-parse';
import Tesseract from 'tesseract.js';
import { Buffer } from 'buffer';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

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

// HWP를 PDF로 변환 후 파싱
export async function parseHWP(buffer: Buffer, filename: string): Promise<string> {
  try {
    // 임시 파일 저장
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const hwpPath = path.join(tempDir, filename);
    const pdfPath = path.join(tempDir, filename.replace('.hwp', '.pdf'));

    // HWP 파일 저장
    fs.writeFileSync(hwpPath, buffer);

    try {
      // LibreOffice를 사용해 PDF로 변환
      // Windows의 경우 libreoffice가 설치되어 있어야 함
      await execAsync(
        `libreoffice --headless --convert-to pdf --outdir "${tempDir}" "${hwpPath}"`,
        { timeout: 30000 }
      );

      if (!fs.existsSync(pdfPath)) {
        throw new Error('PDF 변환 실패');
      }

      // 변환된 PDF 읽기
      const pdfBuffer = fs.readFileSync(pdfPath);
      const text = await parsePDF(pdfBuffer);

      // 임시 파일 정리
      fs.unlinkSync(hwpPath);
      fs.unlinkSync(pdfPath);

      return text;
    } catch (convertError) {
      // LibreOffice 없을 경우 간단한 텍스트 추출 시도
      console.warn('LibreOffice 변환 실패, 대체 방법 사용:', convertError);
      
      // HWP 파일에서 한글 텍스트만 추출
      const hexBuffer = buffer.toString('binary');
      const koreanMatches = buffer
        .toString('utf-8', 0, Math.min(100000, buffer.length))
        .match(/[\uAC00-\uD7A3\u3130-\u318F\u3131-\u3163]+/g) || [];
      
      if (koreanMatches.length > 0) {
        return koreanMatches.join(' ');
      }

      // 임시 파일 정리
      try {
        fs.unlinkSync(hwpPath);
      } catch {}

      // 최후의 수단: 제목에서 정보 추출
      const titleMatch = filename.match(/\[([^\]]+)\]/);
      if (titleMatch) {
        return titleMatch[1] + ' ' + filename;
      }

      throw new Error('HWP 파일을 읽을 수 없습니다. LibreOffice 설치가 필요합니다.');
    }
  } catch (error) {
    throw new Error(`HWP 파싱 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
  }
}

// 텍스트에서 핵심 정보 추출
export function extractTravelInfo(text: string, filename?: string): ParsedDocument['extractedData'] {
  const data: ParsedDocument['extractedData'] = {
    rawText: text,
    itinerary: [],
    inclusions: [],
    excludes: [],
    accommodations: [],
  };

  // 파일명에서 정보 추출 (HWP의 경우 매우 유용)
  if (filename) {
    // 파일명에서 패키지명 추출 (예: "[5월 황금연휴]오사카 나라 고베 교토 OR USJ 3일")
    let titleFromFilename = filename.replace(/\.hwp$/i, '').trim();
    if (!data.title) {
      data.title = titleFromFilename;
    }

    // 파일명에서 여행지 추출: 대괄호 사이의 텍스트 제외
    const destMatch = titleFromFilename.match(/(?:\][^\d]*)?([가-힣\s\.~])+([\d위])?(?:\s|$)/);
    if (destMatch && !data.destination) {
      data.destination = destMatch[0].trim().slice(0, 50);
    }

    // 파일명에서 기간 추출 (예: "3일")
    const durationMatch = titleFromFilename.match(/(\d+)\s*박\s*(\d+)\s*일|(\d+)\s*일\s*PKG/i);
    if (durationMatch && !data.duration) {
      const days = durationMatch[2] || durationMatch[3];
      data.duration = parseInt(days);
    }
  }

  // 제목 추출 (첫 번째 줄 또는 큰 텍스트)
  const titleMatch = text.match(/^([^\n]{5,100})/m);
  if (titleMatch && !data.title) {
    const extracted = titleMatch[1].trim();
    // 바이너리 데이터가 아닌지 확인
    if (extracted.length > 5 && extracted.charCodeAt(0) > 127) {
      // 바이너리 가능성 높음, 사용 안함
    } else {
      data.title = extracted;
    }
  }

  // 여행지 추출
  const destMatch = text.match(
    /(목적지|여행지|도시|지역|장소)[\s:]*([^,\n]+)/i
  );
  if (destMatch && !data.destination) {
    data.destination = destMatch[2].trim();
  }

  // 기간 추출 (예: "3박 4일", "4일간")
  const durationMatch = text.match(/(\d+)\s*박\s*(\d+)\s*일|(\d+)\s*일간?/i);
  if (durationMatch && !data.duration) {
    const days = durationMatch[2] || durationMatch[3];
    data.duration = parseInt(days);
  }

  // 가격 추출 (예: "450,000원", "450000원")
  const priceMatch = text.match(/([0-9,]+)\s*원/);
  if (priceMatch && !data.price) {
    const priceStr = priceMatch[1].replace(/,/g, '');
    data.price = parseInt(priceStr);
  }

  // 일정 추출 (Day/날짜로 시작하는 라인들)
  const itineraryMatches = text.match(/(?:Day\s*\d+|Day \d+|첫.{0,2}날|둘.{0,2}날|셋.{0,2}날)[\s:]*([^\n]+)/gi);
  if (itineraryMatches && !data.itinerary?.length) {
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
        rawText = await parseHWP(buffer, filename);
        break;
      default:
        throw new Error(`지원하지 않는 파일 형식: ${ext}`);
    }

    if (!rawText) {
      throw new Error('파일에서 텍스트를 추출할 수 없습니다.');
    }

    const extractedData = extractTravelInfo(rawText, filename);

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