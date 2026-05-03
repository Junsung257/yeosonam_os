/**
 * 알림 어댑터 패턴
 *
 * 추후 카카오 알림톡 / 이메일 / SMS 등 다양한 채널 추가 시
 * 이 파일만 수정하면 됩니다. 기존 비즈니스 로직 변경 불필요.
 *
 * 현재:
 *   - Solapi 미설정 → MockAdapter (message_logs DB 기록만)
 *   - Solapi 설정됨 → KakaoAdapter (알림톡 발송 + DB 기록)
 */

import type { MessageEventType } from './booking-state-machine';

export interface NotificationPayload {
  bookingId: string;
  eventType: MessageEventType;
  title: string;
  content?: string;
  customerName?: string;
  customerPhone?: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationResult {
  success: boolean;
  isMock: boolean;
  logId?: string;
  error?: string;
}

export interface NotificationAdapter {
  send(payload: NotificationPayload): Promise<NotificationResult>;
  getChannelName(): string;
}

// ─────────────────────────────────────────────
// Mock 어댑터: DB 기록만 (실제 발송 없음)
// ─────────────────────────────────────────────
class MockNotificationAdapter implements NotificationAdapter {
  getChannelName() { return 'mock'; }

  async send(payload: NotificationPayload): Promise<NotificationResult> {
    try {
      const { createMessageLog } = await import('./supabase');
      const log = await createMessageLog({
        booking_id: payload.bookingId,
        log_type:   'mock',
        event_type: payload.eventType,
        title:      payload.title,
        content:    payload.content,
        is_mock:    true,
        created_by: 'system',
      });
      console.log(`[Mock 알림] ${payload.eventType}: ${payload.title}`);
      return { success: true, isMock: true, logId: log?.id };
    } catch (e) {
      const err = e instanceof Error ? e.message : '알림 로그 저장 실패';
      console.error('[MockAdapter 오류]', e);
      return { success: false, isMock: true, error: err };
    }
  }
}

// ─────────────────────────────────────────────
// Kakao 어댑터: 알림톡 발송 시도 후 DB 기록
// 발송 실패해도 DB 기록은 보장
// ─────────────────────────────────────────────
class KakaoNotificationAdapter implements NotificationAdapter {
  getChannelName() { return 'kakao'; }

  private async mintTripPortalUrl(bookingId: string): Promise<string | null> {
    try {
      const { mintGuestPortalToken } = await import('./booking-guest-token');
      const { portalUrl } = await mintGuestPortalToken(bookingId);
      return portalUrl;
    } catch (e) {
      console.warn('[KakaoAdapter] 예약 포털 토큰 발급 실패 (마이그레이션·DB 확인)', e);
      return null;
    }
  }

  async send(payload: NotificationPayload): Promise<NotificationResult> {
    let kakaoSent = false;

    let skipReason: string | null = null;

    // 알림톡 발송 시도 (이벤트 타입별 분기)
    try {
      if (payload.customerPhone && payload.customerName) {
        const { sendBalanceNotice, sendDepositNoticeAlimtalk } = await import('./kakao');
        const account = process.env.COMPANY_ACCOUNT;

        if (payload.eventType === 'DEPOSIT_NOTICE') {
          if (!account) {
            skipReason = 'COMPANY_ACCOUNT 환경변수 미설정 — 계약금 안내 발송 스킵';
            console.error('[KakaoAdapter]', skipReason);
          } else {
            let portalUrl = await this.mintTripPortalUrl(payload.bookingId);
            if (!portalUrl) {
              const base = (process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
              portalUrl = base ? `${base}/` : '';
            }
            if (!portalUrl) {
              skipReason = '예약 포털 링크 생성 실패 — NEXT_PUBLIC_BASE_URL·booking_guest_tokens 테이블 확인';
              console.error('[KakaoAdapter]', skipReason);
            } else {
              const depRes = await sendDepositNoticeAlimtalk({
                phone: payload.customerPhone,
                name: payload.customerName,
                packageTitle: (payload.metadata?.packageTitle as string) ?? '여행 상품',
                bookingNo: (payload.metadata?.bookingNo as string) ?? '',
                depositAmount: (payload.metadata?.depositAmount as number) ?? 0,
                dueDate: (payload.metadata?.dueDate as string) ?? '',
                account,
                portalUrl,
              });
              kakaoSent = depRes?.skipped !== true;
              if (depRes?.skipped) {
                skipReason =
                  (depRes as { mode?: string }).mode === 'manual'
                    ? 'KAKAO_TEMPLATE_DEPOSIT 미설정 또는 Solapi 수기 모드'
                    : '계약금 알림톡 스킵';
              }
            }
          }
        } else if (payload.eventType === 'BALANCE_NOTICE') {
          if (!account) {
            skipReason = 'COMPANY_ACCOUNT 환경변수 미설정 — 잔금 안내 발송 스킵';
            console.error('[KakaoAdapter]', skipReason);
          } else {
            const portalUrl = await this.mintTripPortalUrl(payload.bookingId);
            const balRes = await sendBalanceNotice({
              phone:        payload.customerPhone,
              name:         payload.customerName,
              packageTitle: (payload.metadata?.packageTitle as string) ?? '여행 상품',
              balance:      (payload.metadata?.balance as number) ?? 0,
              dueDate:      (payload.metadata?.dueDate as string) ?? '출발 2주 전',
              account,
              ...(portalUrl ? { portalUrl } : {}),
            });
            kakaoSent = balRes?.skipped !== true;
          }
        }
      }
    } catch (e) {
      console.warn('[KakaoAdapter 발송 실패]', e);
      skipReason = e instanceof Error ? e.message : 'unknown error';
    }

    // DB 기록 (발송 성공 여부와 무관하게 항상 기록)
    try {
      const { createMessageLog } = await import('./supabase');
      const log = await createMessageLog({
        booking_id: payload.bookingId,
        log_type:   kakaoSent ? 'kakao' : 'system',
        event_type: payload.eventType,
        title:      payload.title,
        content:    skipReason ? `${payload.content ?? ''}\n[발송 스킵] ${skipReason}`.trim() : payload.content,
        is_mock:    false,
        created_by: 'system',
      });
      return { success: kakaoSent || !skipReason, isMock: false, logId: log?.id, error: skipReason ?? undefined };
    } catch (e) {
      const err = e instanceof Error ? e.message : '로그 저장 실패';
      return { success: false, isMock: false, error: err };
    }
  }
}

// ─────────────────────────────────────────────
// 팩토리: 환경변수에 따라 어댑터 자동 선택
// ─────────────────────────────────────────────
function isSolapiConfigured(): boolean {
  return !!(
    process.env.SOLAPI_API_KEY &&
    process.env.SOLAPI_API_SECRET &&
    process.env.KAKAO_CHANNEL_ID &&
    process.env.KAKAO_SENDER_NUMBER
  );
}

export function getNotificationAdapter(): NotificationAdapter {
  return isSolapiConfigured()
    ? new KakaoNotificationAdapter()
    : new MockNotificationAdapter();
}
