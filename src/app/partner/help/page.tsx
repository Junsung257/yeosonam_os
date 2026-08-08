import Link from 'next/link';

export default function PartnerHelpPage() {
  return (
    <section className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
      <h1 className="text-2xl font-black">파트너 로그인 도움말</h1>
      <p className="mt-4 leading-7 text-slate-600">
        초대 링크가 만료되었거나 기존 PIN만 보유한 파트너는 운영 담당자에게 자격증명 재발급을 요청해 주세요. 재발급 시 기존 로그인 세션은 즉시 종료됩니다.
      </p>
      <Link href="/inquiry" className="mt-6 inline-flex min-h-12 items-center rounded-xl bg-blue-600 px-5 font-bold text-white">운영팀에 문의하기</Link>
    </section>
  );
}

