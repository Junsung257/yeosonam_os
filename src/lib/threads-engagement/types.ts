export interface ThreadsCredentials {
  accessToken: string;
  userId: string;
}

export interface ThreadsPostSummary {
  id: string;
  text: string;
  username: string;
  timestamp: string;
  permalink?: string;
  isReply?: boolean;
}

export interface ThreadsConversationItem extends ThreadsPostSummary {
  repliedToId?: string;
  isOwnedByMe?: boolean;
  hasReplies?: boolean;
}

export interface ThreadsInboxItem {
  id: string;
  kind: 'reply' | 'mention';
  text: string;
  username: string;
  timestamp: string;
  rootPostId?: string;
  rootPostText?: string;
  permalink?: string;
}

export type ThreadsPolicyDecision = 'reply' | 'skip' | 'escalate';

export interface ThreadsPolicyResult {
  decision: ThreadsPolicyDecision;
  reason:
    | 'safe_conversation'
    | 'empty'
    | 'self_authored'
    | 'spam'
    | 'prompt_injection'
    | 'personal_data'
    | 'booking_or_payment'
    | 'complaint_or_dispute'
    | 'regulated_advice'
    | 'unsafe_language';
  fallbackReply?: string;
}

export interface ThreadsPublishedReply {
  id: string;
  permalink?: string;
}

export interface ThreadsRunSummary {
  [key: string]: unknown;
  ok: boolean;
  configured: boolean;
  accountEnabled: boolean;
  scannedPosts: number;
  discoveredReplies: number;
  discoveredMentions: number;
  claimed: number;
  published: number;
  escalated: number;
  skipped: number;
  failed: number;
  mentionsAvailable: boolean;
  errors: string[];
}
