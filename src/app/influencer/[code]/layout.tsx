'use client';

import { useParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { InfluencerAuthContext } from './auth-context';
import type { AffiliateInfo } from './auth-context';

export default function InfluencerLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const code = params.code as string;

  const [affiliate, setAffiliate] = useState<AffiliateInfo | null>(null);
  const [authenticated, setAuthenticated] = useState(false);

  // sessionStorage에서 인증 상태 복원
  useEffect(() => {
    const stored = sessionStorage.getItem(`inf_auth_${code}`);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setAffiliate(parsed);
        setAuthenticated(true);
      } catch { /* ignore */ }
    }
  }, [code]);

  const handleSetAuth = (a: AffiliateInfo) => {
    setAffiliate(a);
    setAuthenticated(true);
    sessionStorage.setItem(`inf_auth_${code}`, JSON.stringify(a));
  };

  const GRADE_COLORS: Record<number, string> = {
    1: 'bg-amber-700', 2: 'bg-gray-400', 3: 'bg-yellow-500', 4: 'bg-cyan-500', 5: 'bg-purple-500',
  };

  const navItems = [
    { href: `/influencer/${code}`, label: '대시보드', icon: '📊' },
    { href: `/influencer/${code}/products`, label: '상품 & 링크', icon: '🔗' },
    { href: `/influencer/${code}/assets`, label: '마케팅 소재', icon: '🎨' },
  ];

  return (
    <InfluencerAuthContext.Provider value={{ affiliate, authenticated, setAuth: handleSetAuth }}>
      <div className="min-h-screen bg-gray-50">
        {/* 상단 네비게이션 */}
        <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
          <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
            {/* 좌측: 로고 + 이름 */}
            <div className="flex items-center gap-3">
              {affiliate?.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={affiliate.logo_url} alt="" className="h-8 w-8 rounded-full object-cover" />
              ) : (
                <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm">
                  {affiliate?.name?.[0] || code[0]}
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-900 text-sm">{affiliate?.name || code}</span>
                {affiliate && (
                  <span className={`text-[10px] text-white px-1.5 py-0.5 rounded-full font-bold ${GRADE_COLORS[affiliate.grade] || 'bg-gray-400'}`}>
                    {affiliate.grade_label}
                  </span>
                )}
              </div>
            </div>

            {/* 네비게이션 탭 */}
            {authenticated && (
              <nav className="flex gap-1">
                {navItems.map(item => {
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                    >
                      <span className="mr-1">{item.icon}</span>
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            )}

            {/* 우측: 여소남 브랜딩 */}
            <div className="text-[10px] text-gray-400 font-medium">
              Powered by <span className="text-blue-600 font-bold">YEOSONAM</span>
            </div>
          </div>
        </header>

        {/* 메인 콘텐츠 */}
        <main className="max-w-6xl mx-auto px-4 py-6">
          {children}
        </main>

        {/* 푸터 */}
        <footer className="border-t border-gray-200 bg-white py-4 mt-auto">
          <div className="max-w-6xl mx-auto px-4 flex justify-between items-center text-xs text-gray-400">
            <span>여소남 파트너 포털</span>
            <span>문의: partner@yeosonam.co.kr</span>
          </div>
        </footer>
      </div>
    </InfluencerAuthContext.Provider>
  );
}
