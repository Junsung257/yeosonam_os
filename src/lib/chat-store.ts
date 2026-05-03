'use client';

import { create } from 'zustand';

export type EscalationButtonAction = 'phone' | 'kakao';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  type?: 'text' | 'product_cards' | 'buttons' | 'cta_links';
  products?: { id: string; title: string; destination?: string; duration?: number; nights?: number; price?: number }[];
  /** 레거시: 클릭 시 문자열을 다시 /api/qa/chat 으로 전송 */
  buttons?: string[];
  /** 에스컬레이션 CTA — 클릭 시 전화·카톡 등 실제 채널 (buttons 보다 우선) */
  buttonActions?: { action: EscalationButtonAction; label: string }[];
  ctaLinks?: { label: string; href: string }[];
  timestamp: Date;
  isStreaming?: boolean;
}

interface ChatStore {
  isOpen: boolean;
  messages: ChatMessage[];
  sessionId: string;
  isTyping: boolean;

  toggleChat: () => void;
  openChat: () => void;
  closeChat: () => void;
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => string;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  appendToMessage: (id: string, chunk: string) => void;
  setTyping: (isTyping: boolean) => void;
  clearMessages: () => void;
}

function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return 'ssr';
  let sid = sessionStorage.getItem('ys_chat_session');
  if (!sid) {
    sid = crypto.randomUUID();
    sessionStorage.setItem('ys_chat_session', sid);
  }
  return sid;
}

export const useChatStore = create<ChatStore>((set) => ({
  isOpen: false,
  messages: [],
  sessionId: getOrCreateSessionId(),
  isTyping: false,

  toggleChat: () => set((state) => ({ isOpen: !state.isOpen })),
  openChat: () => set({ isOpen: true }),
  closeChat: () => set({ isOpen: false }),

  addMessage: (message) => {
    const id = crypto.randomUUID();
    set((state) => ({
      messages: [
        ...state.messages,
        { ...message, id, timestamp: new Date() },
      ],
    }));
    return id;
  },

  updateMessage: (id, patch) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),

  appendToMessage: (id, chunk) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + chunk } : m,
      ),
    })),

  setTyping: (isTyping) => set({ isTyping }),
  clearMessages: () => set({ messages: [] }),
}));
