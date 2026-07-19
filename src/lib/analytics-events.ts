export const ANALYTICS_EVENTS = {
  packageFilterApplied: 'package_filter_applied',
  stickyCtaClicked: 'sticky_cta_clicked',
  kakaoClicked: 'kakao_clicked',
  aiPromptStarted: 'ai_prompt_started',
  aiRecommendationClicked: 'ai_recommendation_clicked',
  rfqSubmitted: 'rfq_submitted',
  rfqShareOpened: 'rfq_share_opened',
  rfqProposalReady: 'rfq_proposal_ready',
  rfqSelected: 'rfq_selected',
  rfqContracted: 'rfq_contracted',
  adminActionCompleted: 'admin_action_completed',
} as const;

export type AnalyticsEventName =
  (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];
