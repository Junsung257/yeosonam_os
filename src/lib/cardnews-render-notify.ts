import { supabaseAdmin } from "@/lib/supabase";

export interface CardNewsRenderNotification {
  cardNewsId: string;
  destination?: string;
  slideCount: number;
  duration: number; // ms
  success: boolean;
  imageUrls: string[];
}

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

/**
 * 카드뉴스 PNG 렌더링 완료 알림을 Slack으로 전송한다.
 *
 * 성공 시 초록색 Block Kit 메시지 (카드뉴스 ID, 슬라이드 수, 렌더링 시간, 첫 이미지 썸네일),
 * 실패 시 빨간색 알림을 전송한다.
 *
 * Slack Webhook URL이 설정되어 있지 않으면 조용히 false를 반환한다.
 * @returns 전송 성공 시 true
 */
export async function notifyCardNewsRenderComplete(
  notification: CardNewsRenderNotification
): Promise<boolean> {
  if (!SLACK_WEBHOOK_URL) {
    console.warn(
      "[cardnews-render-notify] SLACK_WEBHOOK_URL이 설정되지 않았습니다. 알림을 보내지 않습니다."
    );
    return false;
  }

  const adminUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://yeosonam.com";
  const cardNewsLink = `${adminUrl}/admin/content-hub/${notification.cardNewsId}`;

  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: notification.success
          ? "🖼️ 카드뉴스 렌더링 완료"
          : "❌ 카드뉴스 렌더링 실패",
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*카드뉴스 ID*\n\`${notification.cardNewsId}\``,
        },
        {
          type: "mrkdwn",
          text: `*슬라이드 수*\n${notification.slideCount}장`,
        },
      ],
    },
  ];

  if (notification.success) {
    const durationSec = (notification.duration / 1000).toFixed(1);
    blocks.push({
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*렌더링 시간*\n${durationSec}초`,
        },
        {
          type: "mrkdwn",
          text: `*생성 이미지*\n${notification.imageUrls.length}개`,
        },
      ],
    });
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*소요 시간*\n${notification.duration}ms 후 실패`,
      },
    });
  }

  // 성공 시 첫 이미지 썸네일 표시
  if (notification.success && notification.imageUrls.length > 0) {
    blocks.push({
      type: "image",
      title: {
        type: "plain_text",
        text: "첫 번째 슬라이드 미리보기",
        emoji: true,
      },
      image_url: notification.imageUrls[0],
      alt_text: "카드뉴스 첫 슬라이드",
    });
  }

  // 바로가기
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `<${cardNewsLink}|🔗 콘텐츠 허브에서 보기>`,
    },
  });

  // 구분선 + 타임스탬프
  blocks.push(
    { type: "divider" },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `<!date^${Math.floor(Date.now() / 1000)}^{date_pretty} {time}|방금 전> · 여소남 OS 카드뉴스 알림`,
        },
      ],
    }
  );

  try {
    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attachments: [
          {
            color: notification.success ? "#36a64f" : "#d00000",
            blocks,
          },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(
        `[cardnews-render-notify] Slack 전송 실패 (${response.status}):`,
        text
      );
      return false;
    }

    console.log(
      `[cardnews-render-notify] Slack 알림 전송 완료: ${
        notification.success ? "성공" : "실패"
      } — ${notification.cardNewsId}`
    );
    return true;
  } catch (err) {
    console.error(
      "[cardnews-render-notify] Slack Webhook 호출 중 예외:",
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}
