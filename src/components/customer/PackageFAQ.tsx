'use client';

/**
 * PackageFAQ — 패키지 상세 페이지 자주 묻는 질문
 *
 * 확장 전략:
 *   현재: 정적 공통 FAQ + 목적지별 분기
 *   미래: DB의 package_faqs 테이블에서 상품별 커스텀 FAQ 오버레이 (JARVIS 자동 생성)
 */

import { useState } from 'react';

interface FaqItem {
  question: string;
  answer: string;
}

const COMMON_FAQS: FaqItem[] = [
  {
    question: '예약은 어떻게 하나요?',
    answer: '하단 "카톡 예약하기" 버튼으로 카카오톡 채널에 연결되면, 원하시는 출발일과 인원을 알려주시면 바로 안내해드립니다. 상담 후 입금 확인으로 예약이 확정됩니다.',
  },
  {
    question: '혼자도 참여할 수 있나요?',
    answer: '네, 1인 참여 가능합니다. 단, 상품마다 최소 출발 인원이 있으며, 최소 인원 미달 시 출발이 취소될 수 있습니다. 출발 확정 여부는 달력에서 "출발확정" 표시로 확인하세요.',
  },
  {
    question: '현지 가이드는 한국인인가요?',
    answer: '네, 한국인 가이드가 동행합니다. 언어 걱정 없이 편안하게 여행하실 수 있습니다.',
  },
  {
    question: '항공 수하물은 몇 kg까지 가능한가요?',
    answer: '항공사마다 다릅니다. 일반적으로 위탁 수하물 20kg + 기내 수하물 10kg이나, 출발 전 항공사 기준을 확인해 주세요. 추가 수하물은 현장 구매 가능합니다.',
  },
  {
    question: '취소 시 환불은 어떻게 되나요?',
    answer: '출발 30일 전 취소 시 전액 환불, 20일 전 10% 공제, 10일 전 30% 공제, 3일 전 50% 공제됩니다. 전체 약관은 하단 유의사항을 참고해 주세요.',
  },
  {
    question: '현지 인터넷(유심/포켓와이파이)은 어떻게 준비하나요?',
    answer: '인천공항 또는 현지 공항에서 유심 구매를 권장합니다. 출국 전 통신사 로밍을 신청하셔도 됩니다. 포켓와이파이는 일행이 여럿이면 편리합니다.',
  },
];

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
  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between py-3.5 text-left gap-3 group"
      >
        <span className="text-sm font-medium text-gray-800 group-hover:text-brand transition-colors leading-snug">
          {item.question}
        </span>
        <span className={`shrink-0 text-gray-400 text-base transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
          ∨
        </span>
      </button>
      {open && (
        <p className="pb-4 text-sm text-gray-600 leading-relaxed -mt-1">
          {item.answer}
        </p>
      )}
    </div>
  );
}

interface Props {
  destination: string;
  kakaoChannel?: () => void;
}

export default function PackageFAQ({ destination, kakaoChannel }: Props) {
  const destFaqs = getDestinationFaqs(destination ?? '');
  const allFaqs = [...destFaqs, ...COMMON_FAQS];

  return (
    <section className="px-4 py-8">
      <h2 className="text-lg font-extrabold text-gray-900 mb-4">💬 자주 묻는 질문</h2>
      <div className="bg-white border border-gray-100 rounded-2xl px-4 divide-y divide-gray-100">
        {allFaqs.map((item, i) => (
          <FaqRow key={i} item={item} />
        ))}
      </div>
      {kakaoChannel && (
        <button
          type="button"
          onClick={kakaoChannel}
          className="mt-4 w-full py-3 rounded-2xl bg-[#FEE500] text-[#3C1E1E] font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
        >
          <span>💬</span>
          <span>다른 궁금한 점은 카톡으로 바로 문의</span>
        </button>
      )}
    </section>
  );
}
