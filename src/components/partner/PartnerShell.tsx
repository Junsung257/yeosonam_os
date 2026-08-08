"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

const NAV = [
  { href: "/partner", label: "홈", short: "홈" },
  { href: "/partner/products", label: "상품 찾기", short: "상품" },
  { href: "/partner/publish", label: "게시하기", short: "게시" },
  { href: "/partner/publications", label: "게시물 관리", short: "게시물" },
  { href: "/partner/performance", label: "성과", short: "성과" },
  { href: "/partner/bookings", label: "예약", short: "예약" },
  { href: "/partner/earnings", label: "수익·정산", short: "정산" },
  { href: "/partner/settings", label: "설정", short: "설정" },
  { href: "/partner/help", label: "도움말", short: "도움" },
];

function selected(pathname: string, href: string) {
  return href === "/partner" ? pathname === href : pathname.startsWith(href);
}

export function PartnerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const authPage =
    pathname === "/partner/login" || pathname === "/partner/activate";

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/partner/auth/session", { method: "DELETE" });
    } finally {
      router.replace("/partner/login");
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/partner" className="font-black tracking-tight">
            여소남 파트너
          </Link>
          {!authPage ? (
            <button
              type="button"
              onClick={logout}
              disabled={loggingOut}
              className="min-h-11 rounded-xl px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              {loggingOut ? "종료 중" : "로그아웃"}
            </button>
          ) : (
            <Link
              href="/partner/help"
              className="rounded-xl px-3 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-100"
            >
              도움말
            </Link>
          )}
        </div>
      </header>

      {authPage ? (
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
          {children}
        </main>
      ) : (
        <div className="mx-auto grid w-full max-w-7xl lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="hidden min-h-[calc(100vh-4rem)] border-r border-slate-200 bg-white p-4 lg:block">
            <nav
              aria-label="파트너 주요 메뉴"
              className="sticky top-4 space-y-1"
            >
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={
                    selected(pathname, item.href) ? "page" : undefined
                  }
                  className={`flex min-h-11 items-center rounded-xl px-4 text-sm font-bold ${selected(pathname, item.href) ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="min-w-0 px-4 py-6 pb-28 sm:px-6 lg:py-8 lg:pb-12">
            {children}
          </main>
        </div>
      )}

      {!authPage ? (
        <nav
          aria-label="파트너 모바일 메뉴"
          className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-200 bg-white px-1 pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          {NAV.slice(0, 4)
            .concat(NAV[6])
            .map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={
                  selected(pathname, item.href) ? "page" : undefined
                }
                className={`flex min-h-16 items-center justify-center px-1 text-center text-[11px] font-bold ${selected(pathname, item.href) ? "text-blue-700" : "text-slate-500"}`}
              >
                {item.short}
              </Link>
            ))}
        </nav>
      ) : null}
    </div>
  );
}
