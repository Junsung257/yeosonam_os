import { supabaseAdmin } from "@/lib/supabase";

export interface ReviewNotification {
  creativeId: string;
  eventType: "queued" | "approved" | "rejected" | "changes_requested";
  reviewerId?: string;
  reviewNote?: string;
}

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

/**
 * 이벤트 타입별 Slack 메시지 색상과 제목 prefix
 */
const EVENT_STYLES: Record<
  ReviewNotification["eventType"],
  { color: string; title: string; emoji: string }
> = {
  queued: {
    color: "#36a64f",
    title: "📝 새 콘텐츠 검토 요청",
    emoji: ":memo:",
  },
  approved: {
    color: "#2eb886",
    title: "✅ 콘텐츠 승인 완료",
    emoji: ":white_check_mark:",
  },
  rejected: {
    color: "#d00000",
    title: "❌ 콘텐츠 반려",
    emoji: ":x:",
  },
  changes_requested: {
    color: "#e67e22",
    title: "🔧 콘텐츠 수정 요청",
    emoji: ":wrench:",
  },
};

/**
 * 검토 알림 한 건을 Slack으로 전송한다.
 *
 * Slack Webhook URL이 설정되어 있지 않으면 조용히 false를 반환한다.
 * @returns 전송 성공 시 true
 */
export async function sendReviewNotification(
  notification: ReviewNotification
): Promise<boolean> {
  if (!SLACK_WEBHOOK_URL) {
    console.warn(
      "[content-review-notify] SLACK_WEBHOOK_URL이 설정되지 않았습니다. 알림을 보내지 않습니다."
    );
    return false;
  }

  const style = EVENT_STYLES[notification.eventType];
  const adminUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://yeosonam.com";
  const creativeLink = `${adminUrl}/admin/content-hub/${notification.creativeId}`;

  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: style.title,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*크리에이티브 ID*\n\`${notification.creativeId}\``,
        },
        {
          type: "mrkdwn",
          text: `*이벤트*\n${style.emoji} ${notification.eventType}`,
        },
      ],
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*바로가기*\n<${creativeLink}|콘텐츠 허브에서 보기>`,
        },
        {
          type: "mrkdwn",
          text: notification.reviewerId
            ? `*검토자*\n\`${notification.reviewerId}\``
            : `*검토자*\n—`,
        },
      ],
    },
  ];

  // 검토 노트가 있으면 추가
  if (notification.reviewNote) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*검토 노트*\n${notification.reviewNote}`,
      },
    });
  }

  // 이벤트 타입별 추가 안내
  if (notification.eventType === "rejected" || notification.eventType === "changes_requested") {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "수정 후 재제출이 필요합니다. 콘텐츠 허브에서 확인해주세요.",
        },
      ],
    });
  }

  // 구분선 + 타임스탬프
  blocks.push(
    { type: "divider" },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `<!date^${Math.floor(Date.now() / 1000)}^{date_pretty} {time}|방금 전> · 여소남 OS 콘텐츠 알림`,
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
            color: style.color,
            blocks,
          },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(
        `[content-review-notify] Slack 전송 실패 (${response.status}):`,
        text
      );
      return false;
    }

    console.log(
      `[content-review-notify] Slack 알림 전송 완료: ${notification.eventType} — ${notification.creativeId}`
    );
    return true;
  } catch (err) {
    console.error(
      "[content-review-notify] Slack Webhook 호출 중 예외:",
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}

/**
 * 대기 중인 검토 항목을 모아 일일 요약 Slack 알림을 전송한다.
 *
 * content_review_queue에서 status = 'queued'인 항목 수를 세고,
 * 0보다 크면 일일 다이제스트를 전송한다.
 *
 * @returns 전송된 알림 수 (0 = 없거나 전송 실패)
 */
export async function notifyPendingReviews(): Promise<number> {
  if (!SLACK_WEBHOOK_URL) {
    console.warn(
      "[content-review-notify] SLACK_WEBHOOK_URL이 설정되지 않았습니다. 일일 알림을 보내지 않습니다."
    );
    return 0;
  }

  try {
    // 대기 중인 검토 항목 수와 목록 조회
    const { data: pendingItems, error, count } = await supabaseAdmin
      .from("content_review_queue")
      .select(
        `
        id,
        creative_id,
        priority,
        reason,
        due_at,
        created_at
      `,
        { count: "exact" }
      )
      .eq("status", "queued")
      .order("priority", { ascending: false });

    if (error) {
      console.error(
        "[content-review-notify] 대기 중인 검토 항목 조회 실패:",
        error.message
      );
      return 0;
    }

    const totalCount = count ?? pendingItems?.length ?? 0;

    if (totalCount === 0) {
      console.log(
        "[content-review-notify] 대기 중인 검토 항목이 없습니다. 다이제스트를 보내지 않습니다."
      );
      return 0;
    }

    const adminUrl =
      process.env.NEXT_PUBLIC_SITE_URL || "https://yeosonam.com";
    const queueLink = `${adminUrl}/admin/content-queue`;

    // 우선순위별 분류
    const highPriority = (pendingItems || []).filter(
      (item) => (item.priority as number) >= 80
    );
    const normalPriority = (pendingItems || []).filter(
      (item) => (item.priority as number) < 80 && (item.priority as number) >= 40
    );

    // 크리에이티브 ID 목록 텍스트
    const itemList =
      (pendingItems || [])
        .slice(0, 10)
        .map(
          (item) =>
            `• \`${item.creative_id}\` (우선순위: ${item.priority}, 사유: ${item.reason})`
        )
        .join("\n") +
      ((pendingItems?.length ?? 0) > 10
        ? `\n...외 ${(pendingItems?.length ?? 0) - 10}건`
        : "");

    const blocks: Record<string, unknown>[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `📋 콘텐츠 검토 일일 요약 (${totalCount}건 대기)`,
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*검토 큐*에 *${totalCount}건*의 콘텐츠가 대기 중입니다.`,
        },
      },
    ];

    if (highPriority.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*🔴 높은 우선순위 (${highPriority.length}건)*`,
        },
      });
    }

    if (normalPriority.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*🟡 일반 우선순위 (${normalPriority.length}건)*`,
        },
      });
    }

    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*대기 목록 (최대 10건)*\n${itemList}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `<${queueLink}|🔗 검토 큐로 이동하기>`,
        },
      },
      { type: "divider" },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `<!date^${Math.floor(Date.now() / 1000)}^{date_pretty}|오늘> 자동 집계 · 여소남 OS 콘텐츠 알림`,
          },
        ],
      }
    );

    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attachments: [
          {
            color: "#36a64f",
            blocks,
          },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(
        `[content-review-notify] 일일 다이제스트 Slack 전송 실패 (${response.status}):`,
        text
      );
      return 0;
    }

    console.log(
      `[content-review-notify] 일일 다이제스트 전송 완료: ${totalCount}건 대기`
    );
    return totalCount;
  } catch (err) {
    console.error(
      "[content-review-notify] 일일 다이제스트 처리 중 예외:",
      err instanceof Error ? err.message : String(err)
    );
    return 0;
  }
}
