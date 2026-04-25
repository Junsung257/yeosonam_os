/**
 * 모든 룰의 레지스트리.
 * 새 룰 추가 시 여기에만 push 하면 러너가 자동 실행.
 */

import type { TaskRule } from '@/types/booking-tasks';
import { unpaidBalanceD7 } from './unpaid-balance-d7';
import { excessPayment } from './excess-payment';
import { lowMargin } from './low-margin';
import { claimKeywordReply } from './claim-keyword-reply';
import { docMissingD3 } from './doc-missing-d3';
import { happyCallFollowup } from './happy-call-followup';

export const ALL_RULES: TaskRule[] = [
  unpaidBalanceD7,
  excessPayment,
  lowMargin,
  claimKeywordReply,
  docMissingD3,
  happyCallFollowup,
];

export {
  unpaidBalanceD7,
  excessPayment,
  lowMargin,
  claimKeywordReply,
  docMissingD3,
  happyCallFollowup,
};
