import { ExternalLink } from 'lucide-react';

interface Citation {
  label: string;
  url: string;
  source: string;
}

/**
 * 목적지·항공사별 공식 참고 링크.
 * E-E-A-T 신호 강화 + GEO(Generative Engine Optimization) 연구에서 AI Overviews 인용률 증가.
 * 실제 검증된 공식 도메인만 사용할 것.
 */
const DESTINATION_CITATIONS: Record<string, Citation[]> = {
  '다낭': [
    { label: '베트남 관광청 (다낭)', url: 'https://vietnam.travel/places-to-go/central-vietnam/da-nang', source: 'vietnam.travel' },
  ],
  '호이안': [
    { label: '베트남 관광청 (호이안)', url: 'https://vietnam.travel/places-to-go/central-vietnam/hoi-an', source: 'vietnam.travel' },
  ],
  '다낭/호이안': [
    { label: '베트남 관광청 (다낭)', url: 'https://vietnam.travel/places-to-go/central-vietnam/da-nang', source: 'vietnam.travel' },
  ],
  '방콕': [
    { label: '태국 관광청 (방콕)', url: 'https://www.tourismthailand.org/Destinations/Provinces/Bangkok/299', source: 'tourismthailand.org' },
  ],
  '푸켓': [
    { label: '태국 관광청 (푸켓)', url: 'https://www.tourismthailand.org/Destinations/Provinces/Phuket/263', source: 'tourismthailand.org' },
  ],
  '발리': [
    { label: '인도네시아 관광 (발리)', url: 'https://www.indonesia.travel/gb/en/destinations/bali-nusa-tenggara/bali', source: 'indonesia.travel' },
  ],
  '북해도': [
    { label: '일본 관광청 (홋카이도)', url: 'https://www.japan.travel/en/destinations/hokkaido/', source: 'japan.travel' },
  ],
  '후쿠오카': [
    { label: '일본 관광청 (후쿠오카)', url: 'https://www.japan.travel/en/destinations/kyushu/fukuoka/', source: 'japan.travel' },
  ],
};

const AIRLINE_CITATIONS: Record<string, Citation> = {
  '에어부산': { label: '에어부산 공식', url: 'https://www.airbusan.com', source: 'airbusan.com' },
  '제주항공': { label: '제주항공 공식', url: 'https://www.jejuair.net', source: 'jejuair.net' },
  '진에어': { label: '진에어 공식', url: 'https://www.jinair.com', source: 'jinair.com' },
  '티웨이': { label: '티웨이항공 공식', url: 'https://www.twayair.com', source: 'twayair.com' },
  '대한항공': { label: '대한항공 공식', url: 'https://www.koreanair.com', source: 'koreanair.com' },
  '아시아나': { label: '아시아나항공 공식', url: 'https://flyasiana.com', source: 'flyasiana.com' },
};

interface Props {
  destination?: string;
  airline?: string;
}

export default function BlogCitations({ destination, airline }: Props) {
  const destCitations = destination ? DESTINATION_CITATIONS[destination] ?? [] : [];
  const airlineCitation = airline ? AIRLINE_CITATIONS[airline] : null;
  const citations: Citation[] = [...destCitations];
  if (airlineCitation) citations.push(airlineCitation);

  if (citations.length === 0) return null;

  return (
    <section
      className="not-prose my-10 rounded-2xl border border-gray-100 bg-white p-5 md:p-6"
      aria-label="참고 자료"
    >
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-gray-500">
        참고 · 출처
      </h2>
      <ul className="space-y-2 text-sm">
        {citations.map((c, i) => (
          <li key={i}>
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="group inline-flex items-center gap-1.5 text-gray-600 hover:text-[#3182F6]"
            >
              <ExternalLink
                size={13}
                className="opacity-60 transition group-hover:opacity-100"
                aria-hidden="true"
              />
              <span className="font-medium">{c.label}</span>
              <span className="text-xs text-gray-400">— {c.source}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
