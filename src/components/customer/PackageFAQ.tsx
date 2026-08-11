'use client';

import { useState } from 'react';

export interface FaqItem {
  question: string;
  answer: string;
  source?: 'product' | 'policy';
}

export type CustomerFaqNotice =
  | string
  | { title?: string | null; text?: string | null; type?: string | null };

export interface CustomerFaqInput {
  destination?: string | null;
  productType?: string | null;
  minParticipants?: number | null;
  inclusions?: string[] | null;
  notices?: CustomerFaqNotice[] | null;
}

const BOOKING_FAQ: FaqItem = {
  question: '예약은 어떻게 하나요?',
  answer: '',
  source: 'policy',
};

const WIFI_FAQ: FaqItem = {
  question: '현지 인터넷(유심/포켓와이파이)은 어떻게 준비하나요?',
  answer: '출발 전에 유심이나 포켓와이파이를 준비할 수 있어요. 상품에 포함되는지 여부는 예약 상담 때 함께 확인해 주세요.',
  source: 'policy',
};

function cleanNoticeText(notice: CustomerFaqNotice): string {
  if (typeof notice === 'string') return notice.trim();
  return [notice.title, notice.text].filter((value): value is string => Boolean(value?.trim())).join(': ').trim();
}

function findExplicitCancellationNotice(notices: CustomerFaqNotice[] | null | undefined): string | null {
  for (const notice of notices ?? []) {
    const text = cleanNoticeText(notice);
    if (text && /(취소|환불|위약금|수수료)/.test(text)) return text;
  }
  return null;
}

function findExplicitBaggageInclusion(inclusions: string[] | null | undefined): string | null {
  for (const inclusion of inclusions ?? []) {
    const text = inclusion.trim();
    if (/수하물/.test(text) && /\d+\s*(?:kg|킬로)/i.test(text)) return text;
  }
  return null;
}

/**
 * Build customer FAQs only from product facts or safe operational guidance.
 * Never invents cancellation percentages, baggage allowances, visa rules, or
 * guide language that is not present in the product payload.
 */
export function buildCustomerFaqs(input: CustomerFaqInput): FaqItem[] {
  const destination = input.destination?.trim() || '이 상품';
  const minParticipants = Number(input.minParticipants);
  const items: FaqItem[] = [
    {
      ...BOOKING_FAQ,
      answer: `${destination}의 원하는 출발일과 인원을 알려주시면 상담으로 예약 가능 여부와 조건을 안내해 드립니다.`,
    },
    WIFI_FAQ,
  ];

  if (Number.isFinite(minParticipants) && minParticipants > 1) {
    items.splice(1, 0, {
      question: '혼자도 참여할 수 있나요?',
      answer: `이 상품은 최소 ${minParticipants}명 출발 조건입니다. 혼자 신청을 원하시면 해당 날짜의 출발 가능 여부와 추가 조건을 상담으로 먼저 확인해 주세요.`,
      source: 'product',
    });
  } else if (minParticipants === 1) {
    items.splice(1, 0, {
      question: '혼자도 참여할 수 있나요?',
      answer: '상품 기준상 1명 예약이 가능하지만, 출발 가능 여부는 선택한 날짜와 좌석 상황에 따라 상담으로 확인해 주세요.',
      source: 'product',
    });
  }

  const guideInclusion = (input.inclusions ?? []).find((value) => /한국인\s*가이드/.test(value));
  if (guideInclusion) {
    items.splice(2, 0, {
      question: '현지 가이드는 한국인인가요?',
      answer: `상품 포함 내역에 “${guideInclusion.trim()}”로 안내되어 있습니다. 세부 동행 범위는 예약 상담에서 확인해 주세요.`,
      source: 'product',
    });
  }

  const baggageInclusion = findExplicitBaggageInclusion(input.inclusions);
  items.splice(guideInclusion ? 3 : 2, 0, {
    question: '항공 수하물은 몇 kg까지 가능한가요?',
    answer: baggageInclusion
      ? `상품 포함 내역에 “${baggageInclusion}”로 안내되어 있습니다. 항공사별 위탁·기내 수하물 기준은 출발 전에 다시 확인해 주세요.`
      : '수하물 기준은 항공사와 상품별로 다를 수 있어요. 예약 상담 때 포함 여부와 허용량을 정확히 확인해 주세요.',
    source: baggageInclusion ? 'product' : 'policy',
  });

  const cancellationNotice = findExplicitCancellationNotice(input.notices);
  if (cancellationNotice) {
    items.splice(items.length - 1, 0, {
      question: '취소 시 환불은 어떻게 되나요?',
      answer: `상품 유의사항에는 다음과 같이 안내되어 있습니다: ${cancellationNotice} 출발일과 예약 상태에 따른 최종 환불 기준은 상담 때 확인해 주세요.`,
      source: 'product',
    });
  }

  return items.filter((item, index, all) => all.findIndex((candidate) => candidate.question === item.question) === index);
}

function FaqRow({ item }: { item: FaqItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
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
        <div className="pb-4 -mt-1">
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

interface Props extends CustomerFaqInput {
  kakaoChannel?: () => void;
}

export default function PackageFAQ({ kakaoChannel, ...input }: Props) {
  const allFaqs = buildCustomerFaqs(input);

  return (
    <section className="px-4 py-8">
      <h2 className="text-lg font-extrabold text-gray-900 mb-4">💬 자주 묻는 질문</h2>
      <div className="bg-white border border-gray-100 rounded-2xl px-4 divide-y divide-gray-100">
        {allFaqs.map((item, index) => <FaqRow key={`${item.question}-${index}`} item={item} />)}
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
