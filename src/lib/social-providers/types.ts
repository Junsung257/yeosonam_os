/**
 * SocialProvider 인터페이스 — 10년 관점 플랫폼 추상화.
 *
 * 새 플랫폼 (TikTok, YouTube Shorts, LinkedIn, X, Bluesky) 추가 시:
 *   1. 이 인터페이스를 구현한 `<Name>Provider` 클래스 생성
 *   2. registry.ts 에 등록
 *   3. publish-scheduled 크론 분기 제거 (registry 가 dispatch)
 *
 * 공통 제약:
 *   - 모든 메서드는 환경 의존적 실패를 **throw 하지 말고** 결과 객체로 반환
 *   - 토큰 해석은 provider 내부에서 `resolveMetaToken` 등 사용
 *   - 캐러셀/카루셀 등 플랫폼별 특이사항은 publish() 파라미터로 추상화
 *
 * Buffer/Postiz 의 SocialAbstract + Mixpost 패턴 참고 (AGPL → 개념만).
 */

export type SocialPlatform =
  | 'instagram'
  | 'threads'
  | 'tiktok'          // 향후
  | 'youtube_shorts'  // 향후
  | 'linkedin'        // 향후
  | 'x';              // 향후

export interface PublishInput {
  text: string;              // 메인 본문 (플랫폼별 길이 자동 검증)
  mediaUrls?: string[];      // 이미지/영상. 0~N 장 (플랫폼별 max 다름)
  // 향후 확장: videoUrl, thumbnailUrl, locationTag, linkUrl, ...
}

export interface PublishResult {
  ok: boolean;
  postId?: string;           // 플랫폼 native ID
  permalink?: string;        // 공개 URL
  error?: string;
  step?: string;             // 어느 단계에서 실패했는지 (디버깅)
}

export interface QuotaStatus {
  used: number;
  limit: number;
  windowHours: number;       // rolling window (대부분 24)
}

export interface ProviderMetrics {
  views?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  clicks?: number;
  replies?: number;
  reposts?: number;
  quotes?: number;
  ctr?: number;
  spend?: number;
  impressions_legacy?: number;
  raw?: unknown;             // 플랫폼 원본 응답
}

export interface SocialProvider {
  readonly platform: SocialPlatform;

  /** 필수 env 설정 여부 (동기 체크 — 토큰 만료 여부는 별개) */
  isConfigured(): boolean;

  /** 발행. 실패는 throw 하지 말고 PublishResult.ok=false 로. */
  publish(input: PublishInput): Promise<PublishResult>;

  /**
   * 발행 전 사전 쿼터 체크 (있으면).
   * null 반환 = 이 플랫폼은 쿼터 개념 없음 (예: LinkedIn).
   */
  checkQuota?(): Promise<QuotaStatus | null>;

  /**
   * 발행된 포스트의 engagement 지표 조회.
   * 없으면 null. webhook 으로 실시간 받는 플랫폼은 polling 없이 null.
   */
  fetchMetrics?(externalId: string): Promise<ProviderMetrics | null>;

  /**
   * 플랫폼별 유효성 검증 (publish 호출 전 빠른 체크).
   * Default: 텍스트/미디어 개수 제약만.
   */
  validate?(input: PublishInput): { ok: true } | { ok: false; error: string };
}
