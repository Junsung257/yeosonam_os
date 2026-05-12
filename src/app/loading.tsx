// 루트 loading.tsx 는 전체 페이지를 가리는 스켈레톤이 아니라
// Naver/Voyager 식 상단 1px progress strip 으로 — 클릭 직후 페이지 레이아웃이
// 잠깐 딴 모양으로 바뀌는 (보라색 hero 카드 그리드) 느낌을 제거.
//
// 각 라우트는 자체 loading.tsx 에서 더 풍부한 skeleton 을 정의할 수 있음.
export default function Loading() {
  return (
    <div
      aria-label="페이지 로딩 중"
      className="fixed top-0 left-0 right-0 h-[3px] z-[9999] overflow-hidden bg-transparent pointer-events-none"
    >
      <div className="h-full w-1/3 bg-gradient-to-r from-brand via-brand to-brand-dark animate-[loading-bar_1.2s_ease-in-out_infinite]" />
      <style>{`
        @keyframes loading-bar {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}
