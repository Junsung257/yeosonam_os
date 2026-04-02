'use client';

import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  type?: 'text' | 'product_cards' | 'buttons';
  products?: { id: string; title: string; destination?: string; duration?: number; nights?: number; price?: number }[];
  buttons?: string[];
  timestamp: Date;
}

interface ChatStore {
  isOpen: boolean;
  messages: ChatMessage[];
  sessionId: string;
  isTyping: boolean;

  toggleChat: () => void;
  openChat: () => void;
  closeChat: () => void;
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
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

  addMessage: (message) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          ...message,
          id: crypto.randomUUID(),
          timestamp: new Date(),
        },
      ],
    })),

  setTyping: (isTyping) => set({ isTyping }),
  clearMessages: () => set({ messages: [] }),
}));
