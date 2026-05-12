/**
 * POST /api/briefings/generate-ppt
 * 여행 일정 PPT 자동 생성 API
 *
 * Usage:
 * const res = await fetch('/api/briefings/generate-ppt', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     groupName: '창원대 명품 30기',
 *     destination: '청도',
 *     departDate: '2026-06-11',
 *     returnDate: '2026-06-14',
 *     duration: 3,
 *     slides: [
 *       {
 *         title: '부산 — 청도 3박4일',
 *         subtitle: '36홀 골프투어',
 *         layout: 'title',
 *         content: []
 *       },
 *       // ... 추가 슬라이드
 *     ]
 *   })
 * });
 * const blob = await res.blob();
 * // 브라우저 다운로드
 * const url = URL.createObjectURL(blob);
 * const a = document.createElement('a');
 * a.href = url;
 * a.download = `${groupName}-${destination}.pptx`;
 * a.click();
 */

import { generateBriefingPPT, type BriefingConfig } from "@/lib/briefing-ppt-generator";

export async function POST(request: Request) {
  try {
    const config: BriefingConfig = await request.json();

    // 입력 검증
    if (!config.groupName || !config.destination || !config.slides) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: groupName, destination, slides",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // PPT 생성
    const pptBuffer = await generateBriefingPPT(config);

    // 응답 반환
    return new Response(pptBuffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${config.groupName}-${config.destination}.pptx"`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    console.error("[PPT Generation Error]", error);
    return new Response(
      JSON.stringify({
        error: "Failed to generate PPT",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// 유효성 검사 예시
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
