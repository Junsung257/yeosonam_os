'use client';

// Next 15: ssr:false dynamic import 는 Server Component(layout.tsx)에서 금지.
// Client Component 안에서만 호출 가능 → 이 wrapper 가 ChatWidget·BottomTabBar 를 격리.

import dynamic from 'next/dynamic';

const ChatWidget = dynamic(() => import('@/components/ChatWidget'), { ssr: false });
const BottomTabBar = dynamic(() => import('@/components/customer/BottomTabBar'), { ssr: false });

export default function LayoutClientWidgets() {
  return (
    <>
      <ChatWidget />
      <BottomTabBar />
    </>
  );
}
