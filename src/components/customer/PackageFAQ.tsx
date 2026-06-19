'use client';

/**
 * PackageFAQ — 패키지 상세 페이지 자주 묻는 질문
 *
 * 확장 전략:
 *   현재: 정적 공통 FAQ + 목적지별 분기
 *   미래: DB의 package_faqs 테이블에서 상품별 커스텀 FAQ 오버레이 (JARVIS 자동 생성)
 */

import { useId, useState } from 'react';

const PACKAGE_FAQ_KAKAO_DESCRIPTION_ID = 'package-faq-kakao-description';

interface FaqItem {
  question: string;
  answer: string;
}

// 2026-05-14 UX-2: product_type 별 FAQ 풀 분기 (사장님 비전 V5)
//   cruise/ferry → 항공 FAQ 제거, 선실/멀미/차량탑승 FAQ
//   golf → 그린피/캐디팁 FAQ
//   theme → 일반 패키지 FAQ
//   default(package) → 기존 6개

const BOOKING_FAQ: FaqItem = {
  question: '예약은 어떻게 하나요?',
  answer: '하단 "예약 문의" 또는 "카톡 상담" 버튼으로 원하시는 출발일과 인원을 알려주시면 바로 안내해드립니다. 상담 후 조건 확인과 입금 확인을 거쳐 예약이 확정됩니다.',
};
const SOLO_FAQ: FaqItem = {
  question: '혼자도 참여할 수 있나요?',
  answer: '네, 1인 참여 가능합니다. 단, 상품마다 최소 출발 인원이 있으며, 최소 인원 미달 시 출발이 취소될 수 있습니다. 출발 확정 여부는 달력에서 "출발확정" 표시로 확인하세요.',
};
const GUIDE_FAQ: FaqItem = {
  question: '현지 가이드는 한국인인가요?',
  answer: '네, 한국인 가이드가 동행합니다. 언어 걱정 없이 편안하게 여행하실 수 있습니다.',
};
const CANCEL_FAQ: FaqItem = {
  question: '취소 시 환불은 어떻게 되나요?',
  answer: '출발 30일 전 취소 시 전액 환불, 20일 전 10% 공제, 10일 전 30% 공제, 3일 전 50% 공제됩니다. 전체 약관은 하단 유의사항을 참고해 주세요.',
};
const WIFI_FAQ: FaqItem = {
  question: '현지 인터넷(유심/포켓와이파이)은 어떻게 준비하나요?',
  answer: '인천공항 또는 현지 공항에서 유심 구매를 권장합니다. 출국 전 통신사 로밍을 신청하셔도 됩니다. 포켓와이파이는 일행이 여럿이면 편리합니다.',
};

const PACKAGE_FAQS: FaqItem[] = [
  BOOKING_FAQ, SOLO_FAQ, GUIDE_FAQ,
  {
    question: '항공 수하물은 몇 kg까지 가능한가요?',
    answer: '항공사마다 다릅니다. 일반적으로 위탁 수하물 20kg + 기내 수하물 10kg이나, 출발 전 항공사 기준을 확인해 주세요. 추가 수하물은 현장 구매 가능합니다.',
  },
  CANCEL_FAQ, WIFI_FAQ,
];

const CRUISE_FAQS: FaqItem[] = [
  BOOKING_FAQ, SOLO_FAQ, GUIDE_FAQ,
  {
    question: '선실(객실) 등급과 업그레이드는 어떻게 하나요?',
    answer: '기본 다인실로 안내되며, 1등실·디럭스룸 업그레이드는 대기 조건으로 가능합니다. 업그레이드 비용은 상품별 안내사항을 참고해 주세요. 사전 신청은 카톡 상담으로.',
  },
  {
    question: '선박 멀미가 걱정됩니다. 어떻게 대비하나요?',
    answer: '출국 전 약국에서 멀미약(키미테 패치 등)을 미리 준비하시기 바랍니다. 선실에서 휴식 + 수분 섭취 + 갑판에서 수평선 응시가 도움이 됩니다. 큰 선박은 흔들림이 적은 편입니다.',
  },
  {
    question: '차량을 가지고 탑승할 수 있나요?',
    answer: '본 상품은 도보 탑승 패키지입니다. 차량 동반 탑승은 별도 상품이며, 카톡으로 문의해 주세요.',
  },
  CANCEL_FAQ, WIFI_FAQ,
];

const GOLF_FAQS: FaqItem[] = [
  BOOKING_FAQ, SOLO_FAQ, GUIDE_FAQ,
  {
    question: '그린피와 캐디 팁이 포함되나요?',
    answer: '상품별로 다릅니다. 일정표의 포함/불포함 사항을 확인해 주세요. 미포함 시 현지에서 별도 결제하시며, 캐디 팁은 18홀 기준 현지 시세 안내해드립니다.',
  },
  {
    question: '클럽 대여가 가능한가요?',
    answer: '대부분의 골프장에서 클럽 대여가 가능합니다. 사전 예약을 권장하며, 비용은 1라운드 기준 50~100 USD입니다.',
  },
  CANCEL_FAQ, WIFI_FAQ,
];

/** product_type → FAQ 풀 선택 */
function getFaqsByProductType(productType?: string | null): FaqItem[] {
  if (productType === 'cruise' || productType === 'ferry') return CRUISE_FAQS;
  if (productType === 'golf') return GOLF_FAQS;
  return PACKAGE_FAQS;
}

const DESTINATION_FAQS: Record<string, FaqItem[]> = {
  다낭: [
    {
      question: '다낭 입국 시 비자가 필요한가요?',
      answer: '대한민국 여권 소지자는 베트남 무비자 45일 체류 가능합니다 (2023년 8월 확대). 단, 여권 유효기간이 6개월 이상 남아 있어야 합니다.',
    },
    {
      question: '다낭의 날씨는 어떤가요?',
      answer: '다낭은 연중 더운 열대기후입니다. 5~8월은 맑고 더운 건기, 9~12월은 우기입니다. 자외선 차단제와 얇은 긴팔 준비를 권장합니다.',
    },
  ],
  호이안: [
    {
      question: '호이안 구시가지 입장료가 포함되나요?',
      answer: '여소남 패키지에는 호이안 구시가지 입장료가 포함되어 있습니다. 별도 추가 비용 없이 주요 문화유산을 관람하실 수 있습니다.',
    },
  ],
  방콕: [
    {
      question: '태국 입국 시 비자가 필요한가요?',
      answer: '대한민국 여권 소지자는 태국 무비자 30일 체류 가능합니다. 여권 유효기간 6개월 이상 필요합니다.',
    },
  ],
  세부: [
    {
      question: '필리핀 입국 시 필요한 서류가 있나요?',
      answer: '대한민국 여권 소지자는 무비자 30일 체류 가능합니다. 왕복 항공권 또는 출국 증빙을 입국 심사 시 요청받을 수 있습니다.',
    },
  ],
  오사카: [
    {
      question: '일본 입국 시 비자가 필요한가요?',
      answer: '대한민국 여권 소지자는 일본 무비자 90일 체류 가능합니다. 별도 서류 없이 입국 가능합니다.',
    },
  ],
};

function getDestinationFaqs(destination: string): FaqItem[] {
  for (const [key, faqs] of Object.entries(DESTINATION_FAQS)) {
    if (destination.includes(key)) return faqs;
  }
  return [];
}

function FaqRow({ item }: { item: FaqItem }) {
  const [open, setOpen] = useState(false);
  const answerId = useId();
  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={answerId}
        className="w-full flex items-start justify-between py-3.5 text-left gap-3 group"
      >
        <span className="flex items-start gap-2 flex-1 min-w-0">
          <span className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand/10 text-brand text-xs font-bold mt-0.5">Q</span>
          <span className="text-sm font-bold text-gray-900 group-hover:text-brand transition-colors leading-snug">
            {item.question}
          </span>
        </span>
        <span className={`shrink-0 text-gray-400 text-base transition-transform duration-200 mt-1 ${open ? 'rotate-180' : ''}`}>
          ∨
        </span>
      </button>
      {open && (
        <div id={answerId} className="pb-4 -mt-1">
          <div className="flex items-start gap-2 bg-gray-50 rounded-lg p-3 border-l-4 border-brand/40">
            <span className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-200 text-gray-600 text-xs font-bold mt-0.5">A</span>
            <p className="text-sm text-gray-700 leading-relaxed flex-1">
              {item.answer}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

interface Props {
  destination: string;
  /** product_type — cruise/ferry/golf/package — FAQ 풀 분기 (2026-05-14 UX-2) */
  productType?: string | null;
  kakaoChannel?: () => void;
}

export default function PackageFAQ({ destination, productType, kakaoChannel }: Props) {
  const destFaqs = getDestinationFaqs(destination ?? '');
  const baseFaqs = getFaqsByProductType(productType);
  const allFaqs = [...destFaqs, ...baseFaqs];

  return (
    <section className="px-4 py-8">
      <h2 className="text-lg font-extrabold text-gray-900 mb-4">💬 자주 묻는 질문</h2>
      <div className="bg-white border border-gray-100 rounded-2xl px-4 divide-y divide-gray-100">
        {allFaqs.map((item, i) => (
          <FaqRow key={i} item={item} />
        ))}
      </div>
      {kakaoChannel && (
        <>
          <p id={PACKAGE_FAQ_KAKAO_DESCRIPTION_ID} className="sr-only">
            현재 상품과 선택한 출발 조건을 유지한 채 FAQ에서 해결되지 않은 질문을 카카오톡 상담으로 이어갑니다.
          </p>
          <button
            type="button"
            onClick={kakaoChannel}
            data-testid="package-faq-kakao"
            aria-describedby={PACKAGE_FAQ_KAKAO_DESCRIPTION_ID}
            className="mt-4 w-full py-3 rounded-2xl bg-[#FEE500] text-[#3C1E1E] font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
          >
            <span aria-hidden>💬</span>
            <span>다른 궁금한 점은 카톡으로 바로 문의</span>
          </button>
        </>
      )}
    </section>
  );
}
