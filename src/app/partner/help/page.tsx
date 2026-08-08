import Link from 'next/link';

const STEPS = [
  ['1', '승인·초대', '운영 검토가 끝나면 만료 시간이 있는 1회용 초대 링크가 발송됩니다.'],
  ['2', '활성화·로그인', '초대 링크에서 OTP를 확인하면 서버 세션이 만들어집니다. 정적 PIN은 사용하지 않습니다.'],
  ['3', '온보딩', '약관, 채널, 게시 도메인, 계좌·세금 확인, 상품 저장을 순서대로 완료합니다.'],
  ['4', '상품 찾기', '판매 가능 상태·출발일·총액·취소 위험·예약 시점 예상 커미션을 비교합니다.'],
  ['5', '게시 만들기', '채널과 게시 위치 이름을 정하고 고유 publication 링크·QR·HTML 블록을 만듭니다.'],
  ['6', '테스트·외부 게시', '테스트 링크를 열어 유효 클릭을 확인한 뒤 실제 게시 URL을 등록합니다.'],
  ['7', '예약·정산', '클릭부터 예약 귀속, 커미션 원장, 정산 라인, 지급 증빙까지 같은 ID로 추적됩니다.'],
];

export default function PartnerHelpPage() {
  return (
    <div className="space-y-6">
      <header><p className="text-sm font-bold text-blue-700">도움말</p><h1 className="mt-1 text-3xl font-black">승인부터 지급까지 한 흐름</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">파트너가 직접 할 수 있는 설정과 운영팀 확인이 필요한 항목을 단계별로 안내합니다.</p></header>
      <section className="grid gap-3 md:grid-cols-2">
        {STEPS.map(([number, title, description]) => <article key={number} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 font-black text-blue-700">{number}</span><div><h2 className="font-black">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{description}</p></div></article>)}
      </section>
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><h2 className="font-black text-amber-900">막힌 상태를 0건으로 숨기지 않습니다</h2><ul className="mt-3 space-y-2 text-sm leading-6 text-amber-900"><li>상품 API 오류는 “상품 없음”이 아니라 다시 시도할 수 있는 오류 상태로 표시됩니다.</li><li>커미션 정책을 읽지 못하면 예상 수익·정산이 계산 보류로 표시됩니다.</li><li>블로그·홈페이지는 DNS 소유권 확인 전 실제 게시 URL을 등록할 수 없습니다.</li><li>정산 이의제기는 정산서의 “이 금액에 이의제기”에서 접수합니다.</li></ul></section>
      <div className="flex flex-wrap gap-3"><Link href="/partner/products" className="inline-flex min-h-12 items-center rounded-xl bg-blue-600 px-5 font-bold text-white">상품 찾기</Link><Link href="/partner/settings" className="inline-flex min-h-12 items-center rounded-xl border border-slate-300 px-5 font-bold">설정 열기</Link><Link href="/inquiry" className="inline-flex min-h-12 items-center rounded-xl border border-slate-300 px-5 font-bold">운영팀 문의</Link></div>
    </div>
  );
}
