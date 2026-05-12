/**
 * briefing-ppt-generator.ts
 * 여소남 여행 일정 PPT 자동 생성 엔진
 * pptxgenjs + 무료 이미지 API 기반
 */

import PptxGenJS from "pptxgenjs";
import axios from "axios";

export interface BriefingSlide {
  title: string;
  subtitle?: string;
  imageKeyword?: string;
  content: {
    title: string;
    description: string;
    details?: string[];
    imageUrl?: string;
  }[];
  layout?: "title" | "two-col" | "timeline" | "grid";
}

export interface BriefingConfig {
  groupName: string;
  destination: string;
  departDate: string; // YYYY-MM-DD
  returnDate: string; // YYYY-MM-DD
  duration: number; // days
  maxSlides?: number;
  coverImage?: string;
  colors?: {
    primary?: string;
    accent?: string;
    background?: string;
  };
  slides: BriefingSlide[];
}

// 색상 정의
const COLORS = {
  navy: "0B1F3A",
  gold: "C9A14A",
  white: "FFFFFF",
  text: "1A1A1A",
  muted: "6B7280",
  emerald: "0E6E5A",
  sky: "1E5BA8",
};

const FONTS = {
  title: "나눔고딕",
  body: "나눔고딕",
};

/**
 * Unsplash 무료 이미지 URL 생성
 * @param query 검색 키워드
 * @param width 이미지 너비
 * @param quality 품질 (0-100)
 */
export function generateUnsplashUrl(
  query: string,
  width: number = 1600,
  quality: number = 80
): string {
  const encodedQuery = encodeURIComponent(query);
  return `https://images.unsplash.com/photo-${encodedQuery}?w=${width}&q=${quality}`;
}

/**
 * 사전 정의된 고품질 이미지 맵
 * 키워드별 최적의 Unsplash 이미지 ID
 */
export const IMAGE_LIBRARY: Record<string, string> = {
  // 항공
  flight: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=1600&q=80",
  airplane: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=1600&q=80",
  airport: "https://images.unsplash.com/photo-1489824904134-891ab64532f1?w=1600&q=80",

  // 숙박
  hotel: "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1600&q=80",
  "hotel-room": "https://images.unsplash.com/photo-1631049307038-da0ec84d71b2?w=1600&q=80",
  luxury: "https://images.unsplash.com/photo-1578683078519-33db930fccf6?w=1600&q=80",
  sheraton: "https://images.unsplash.com/photo-1580541831550-7323e2e94768?w=1600&q=80",

  // 음식 & 야시장
  beer: "https://images.unsplash.com/photo-1608220945770-fed355f1a406?w=1600&q=80",
  brewery: "https://images.unsplash.com/photo-1608220945770-fed355f1a406?w=1600&q=80",
  "night-market": "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1600&q=80",
  market: "https://images.unsplash.com/photo-1488309185417-d7f9f73721bb?w=1600&q=80",
  street: "https://images.unsplash.com/photo-1488309185417-d7f9f73721bb?w=1600&q=80",
  food: "https://images.unsplash.com/photo-1555939594-58d7cb561e1a?w=1600&q=80",

  // 골프
  golf: "https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=1600&q=80",
  "golf-course": "https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=1600&q=80",
  course: "https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=1600&q=80",

  // 웰니스
  spa: "https://images.unsplash.com/photo-1544161515-81205f8abecc?w=1600&q=80",
  massage: "https://images.unsplash.com/photo-1544161515-81205f8abecc?w=1600&q=80",
  wellness: "https://images.unsplash.com/photo-1609208185948-ed0152ec6981?w=1600&q=80",

  // 도시 & 야경
  city: "https://images.unsplash.com/photo-1490806843957-31f4c9a91c65?w=1600&q=80",
  "night-city": "https://images.unsplash.com/photo-1493514789a586cb146fe2f1b3db3ce7?w=1600&q=80",
  skyline: "https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=1600&q=80",
  "night-view": "https://images.unsplash.com/photo-1490806843957-31f4c9a91c65?w=1600&q=80",

  // 테마파크 & 야경
  "theme-park": "https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=1600&q=80",
  "light-show": "https://images.unsplash.com/photo-1516633472601-b52fc00c496e?w=1600&q=80",

  // 기타
  ocean: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1600&q=80",
  beach: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1600&q=80",
  landscape: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1600&q=80",
  "travel": "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=1600&q=80",
};

/**
 * PPT 생성 메인 함수
 */
export async function generateBriefingPPT(
  config: BriefingConfig
): Promise<ArrayBuffer> {
  const prs = new PptxGenJS();

  // 기본 설정
  prs.defineLayout({ name: "LAYOUT1", width: 10, height: 5.625 }); // 16:9
  prs.defineLayout({ name: "LAYOUT2", width: 10, height: 5.625 });

  // 슬라이드별 생성
  for (const slide of config.slides) {
    await addSlideToPresentation(prs, slide, config);
  }

  // PPT를 ArrayBuffer로 반환 (write outputType:"arraybuffer" 의 실제 반환 타입)
  return (await prs.write({ outputType: "arraybuffer" })) as ArrayBuffer;
}

/**
 * 개별 슬라이드 추가
 */
async function addSlideToPresentation(
  prs: InstanceType<typeof PptxGenJS>,
  slide: BriefingSlide,
  config: BriefingConfig
) {
  const newSlide = prs.addSlide();

  // 슬라이드 배경
  newSlide.background = { color: config.colors?.background || "FFFFFF" };

  switch (slide.layout) {
    case "title":
      addTitleSlide(newSlide, slide, config);
      break;
    case "two-col":
      await addTwoColSlide(newSlide, slide, config);
      break;
    case "timeline":
      addTimelineSlide(newSlide, slide, config);
      break;
    case "grid":
      addGridSlide(newSlide, slide, config);
      break;
    default:
      await addStandardSlide(newSlide, slide, config);
  }
}

/**
 * 제목 슬라이드
 */
function addTitleSlide(
  slide: PptxGenJS.Slide,
  briefing: BriefingSlide,
  config: BriefingConfig
) {
  slide.background = { color: COLORS.navy };

  // 타이틀
  slide.addText(briefing.title, {
    x: 0.5,
    y: 1.5,
    w: 9,
    h: 1,
    fontSize: 48,
    bold: true,
    color: COLORS.white,
    fontFace: "나눔고딕",
  });

  // 서브타이틀
  if (briefing.subtitle) {
    slide.addText(briefing.subtitle, {
      x: 0.5,
      y: 2.6,
      w: 9,
      h: 0.6,
      fontSize: 20,
      color: COLORS.gold,
      fontFace: "나눔고딕",
    });
  }

  // 메타 정보
  slide.addText(
    `${config.departDate} — ${config.returnDate} · ${config.duration}박 ${config.duration + 1}일`,
    {
      x: 0.5,
      y: 3.8,
      w: 9,
      h: 0.4,
      fontSize: 14,
      color: COLORS.muted,
      fontFace: "나눔고딕",
    }
  );
}

/**
 * 2열 슬라이드 (이미지 + 텍스트)
 */
async function addTwoColSlide(
  slide: PptxGenJS.Slide,
  briefing: BriefingSlide,
  config: BriefingConfig
) {
  // 왼쪽: 이미지
  if (briefing.imageKeyword) {
    const imageUrl = IMAGE_LIBRARY[briefing.imageKeyword] || briefing.imageKeyword;
    try {
      slide.addImage({
        path: imageUrl,
        x: 0.3,
        y: 0.5,
        w: 4.5,
        h: 4.5,
      });
    } catch (e) {
      // 이미지 로드 실패 시 색상 블록
      slide.addShape("rect", {
        x: 0.3,
        y: 0.5,
        w: 4.5,
        h: 4.5,
        fill: { color: COLORS.gold },
      });
    }
  }

  // 오른쪽: 텍스트
  let yPos = 0.5;
  slide.addText(briefing.title, {
    x: 5.2,
    y: yPos,
    w: 4.3,
    h: 0.6,
    fontSize: 28,
    bold: true,
    color: COLORS.navy,
    fontFace: "나눔고딕",
  });

  yPos += 0.8;

  for (const content of briefing.content) {
    slide.addText(content.title, {
      x: 5.2,
      y: yPos,
      w: 4.3,
      h: 0.3,
      fontSize: 14,
      bold: true,
      color: COLORS.navy,
      fontFace: "나눔고딕",
    });
    yPos += 0.35;

    slide.addText(content.description, {
      x: 5.2,
      y: yPos,
      w: 4.3,
      h: 0.8,
      fontSize: 11,
      color: COLORS.text,
      fontFace: "나눔고딕",
    });
    yPos += 1;
  }
}

/**
 * 표준 슬라이드
 */
async function addStandardSlide(
  slide: PptxGenJS.Slide,
  briefing: BriefingSlide,
  config: BriefingConfig
) {
  // 헤더
  slide.addText(briefing.title, {
    x: 0.5,
    y: 0.3,
    w: 9,
    h: 0.5,
    fontSize: 28,
    bold: true,
    color: COLORS.navy,
    fontFace: "나눔고딕",
  });

  slide.addShape("line", {
    x: 0.5,
    y: 0.9,
    w: 9,
    h: 0,
    line: { color: COLORS.gold, width: 2 },
  });

  // 콘텐츠
  let yPos = 1.2;
  for (const content of briefing.content) {
    slide.addText(content.title, {
      x: 0.7,
      y: yPos,
      w: 8.6,
      h: 0.35,
      fontSize: 16,
      bold: true,
      color: COLORS.navy,
      fontFace: "나눔고딕",
    });
    yPos += 0.4;

    slide.addText(content.description, {
      x: 0.7,
      y: yPos,
      w: 8.6,
      h: 0.6,
      fontSize: 12,
      color: COLORS.text,
      fontFace: "나눔고딕",
    });
    yPos += 0.8;

    if (content.details) {
      for (const detail of content.details) {
        slide.addText(`• ${detail}`, {
          x: 1,
          y: yPos,
          w: 8.3,
          h: 0.3,
          fontSize: 11,
          color: COLORS.muted,
          fontFace: "나눔고딕",
        });
        yPos += 0.35;
      }
    }

    yPos += 0.2;
  }
}

/**
 * 타임라인 슬라이드
 */
function addTimelineSlide(
  slide: PptxGenJS.Slide,
  briefing: BriefingSlide,
  config: BriefingConfig
) {
  // TODO: 타임라인 레이아웃 구현
  addStandardSlide(slide, briefing, config);
}

/**
 * 그리드 슬라이드
 */
function addGridSlide(
  slide: PptxGenJS.Slide,
  briefing: BriefingSlide,
  config: BriefingConfig
) {
  // TODO: 그리드 레이아웃 구현
  addStandardSlide(slide, briefing, config);
}
