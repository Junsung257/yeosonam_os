import Script from 'next/script';

const PT_ENABLED = process.env.NEXT_PUBLIC_PARTYTOWN === '1';

/**
 * Partytown 런타임 + forward 설정. 루트 레이아웃 최상단(body 직후)에 둔다.
 * public/~partytown 은 `npm run partytown:copy`(postinstall)로 채운다.
 * 서버 컴포넌트: 불필요한 클라이언트 번들 없이 beforeInteractive 스크립트만 주입.
 */
export default function PartytownInit() {
  if (!PT_ENABLED) return null;

  return (
    <>
      <Script
        id="partytown-config"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{
          __html: `partytown={lib:'/~partytown/',forward:['fbq','_fbq','kakaoPixel','clarity']};`,
        }}
      />
      <Script id="partytown-lib" src="/~partytown/partytown.js" strategy="beforeInteractive" />
    </>
  );
}
