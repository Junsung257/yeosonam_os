import Link from 'next/link';

export default function CompanionOnboardingPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-12">
      <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-semibold text-blue-600">동행자 정보 제출 안내</p>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-950">
          온라인 여권정보 제출을 잠시 중단했습니다
        </h1>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          여권번호의 암호화 저장과 접근 권한을 다시 확인하고 있습니다. 이 링크에는 여권번호,
          생년월일, 연락처를 입력하지 마세요. 예약 담당자에게 안전한 제출 방법을 안내받아
          주세요.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/contact"
            className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            담당자 문의
          </Link>
          <Link
            href="/"
            className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            홈으로
          </Link>
        </div>
      </section>
    </main>
  );
}
