'use client';

interface Filters {
  destination: string;
  priceMin: number;
  priceMax: number;
}

interface Props {
  filters: Filters;
  onFilterChange: (f: Filters) => void;
}

export default function ProductSearch({ filters, onFilterChange }: Props) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-6 mb-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 목적지 검색 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">목적지</label>
          <input
            type="text"
            placeholder="예: 다낭, 오사카"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400 transition-colors"
            value={filters.destination}
            onChange={(e) => onFilterChange({ ...filters, destination: e.target.value })}
          />
        </div>

        {/* 최소 가격 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">최소 가격</label>
          <select
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400 transition-colors"
            value={filters.priceMin}
            onChange={(e) => onFilterChange({ ...filters, priceMin: Number(e.target.value) })}
          >
            <option value="0">제한 없음</option>
            <option value="500000">50만원 이상</option>
            <option value="1000000">100만원 이상</option>
            <option value="1500000">150만원 이상</option>
            <option value="2000000">200만원 이상</option>
          </select>
        </div>

        {/* 최대 가격 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">최대 가격</label>
          <select
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400 transition-colors"
            value={filters.priceMax}
            onChange={(e) => onFilterChange({ ...filters, priceMax: Number(e.target.value) })}
          >
            <option value="10000000">제한 없음</option>
            <option value="1000000">100만원 이하</option>
            <option value="1500000">150만원 이하</option>
            <option value="2000000">200만원 이하</option>
            <option value="2500000">250만원 이하</option>
            <option value="3000000">300만원 이하</option>
          </select>
        </div>
      </div>
    </div>
  );
}
