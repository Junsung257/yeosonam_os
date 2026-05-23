'use client';

import { useState } from 'react';
import type { CanonicalView } from '@/lib/render-contract';
import { formatTermLine } from '@/lib/terms-catalog';

type PackageTermsSectionProps = {
  view: Pick<
    CanonicalView,
    'inclusions' | 'excludes' | 'surchargesMerged' | 'shopping' | 'termsMisc'
  >;
  variant?: 'mobile' | 'a4';
};

function renderLine(text: string, remainder?: string | null) {
  if (remainder?.trim()) return `${text} · ${remainder.trim()}`;
  return text;
}

/**
 * 포함/불포함/추가요금/쇼핑 + 하단 기타 안내 — CRC view 전용.
 */
export default function PackageTermsSection({
  view,
  variant = 'mobile',
}: PackageTermsSectionProps) {
  const [programExpanded, setProgramExpanded] = useState(false);

  const hasInclusions =
    view.inclusions.basic.length > 0 || view.inclusions.program.length > 0;
  const excludeLines = view.excludes.display?.length
    ? view.excludes.display
    : view.excludes.basic.map(text => ({ text, slug: null, remainder: null }));
  const hasExcludes = excludeLines.length > 0;
  const hasSurcharges = view.surchargesMerged.length > 0;
  const shoppingLine = view.shopping.displayLine ?? view.shopping.text;
  const hasShopping =
    Boolean(shoppingLine) && !/노쇼핑/.test(shoppingLine ?? '');
  const hasMisc = view.termsMisc.items.length > 0;

  if (!hasInclusions && !hasExcludes && !hasSurcharges && !hasShopping && !hasMisc) {
    return null;
  }

  const isMobile = variant === 'mobile';
  const sectionPad = isMobile ? 'rounded-2xl p-4' : 'rounded p-2';
  const titleCls = isMobile
    ? 'text-xs font-bold mb-3'
    : 'font-bold mb-1 text-[11px]';
  const bodyCls = isMobile
    ? 'text-sm leading-relaxed'
    : 'text-[11px] leading-snug break-keep';

  const hasPeriod = view.surchargesMerged.some(s => s.structured?.start);

  const cleanedProgram = view.inclusions.program
    .map(item =>
      item
        .replace(/^[\s▶■★◈◆·\-]+/u, '')
        .replace(/^특전\s*\d+[.)]\s*/u, '')
        .replace(/^<[^>]+>\s*/u, '')
        .replace(/☞/gu, '—')
        .trim(),
    )
    .filter(Boolean);

  return (
    <div className={isMobile ? 'px-4 py-6 space-y-3' : 'space-y-1.5 mb-1'}>
      {hasInclusions && (
        <div
          className={
            isMobile
              ? `bg-brand-light/50 ${sectionPad}`
              : `bg-blue-50/60 ${sectionPad}`
          }
        >
          <h3
            className={`${titleCls} ${
              isMobile ? 'text-text-primary' : 'text-blue-900'
            }`}
          >
            {isMobile ? '✅ 포함 사항' : '포함 사항'}
          </h3>
          {view.inclusions.basic.length > 0 && (
            <ul
              className={
                isMobile
                  ? 'space-y-1.5'
                  : 'grid grid-cols-2 gap-x-3 gap-y-0.5'
              }
            >
              {view.inclusions.basic.map((item, i) => (
                <li
                  key={i}
                  className={`${bodyCls} text-text-primary flex gap-2`}
                >
                  <span
                    className={
                      isMobile
                        ? 'shrink-0 text-base leading-snug'
                        : 'text-[10px] mr-0.5'
                    }
                  >
                    {item.icon}
                  </span>
                  {renderLine(item.text, item.remainder)}
                </li>
              ))}
            </ul>
          )}
          {cleanedProgram.length > 0 &&
            (isMobile ? (
              <div
                className={
                  view.inclusions.basic.length > 0
                    ? 'mt-3 pt-3 border-t border-brand-light'
                    : ''
                }
              >
                <button
                  type="button"
                  onClick={() => setProgramExpanded(prev => !prev)}
                  aria-expanded={programExpanded}
                  className="w-full flex items-center justify-between text-left active:scale-[0.98] transition py-1"
                >
                  <span className="text-sm font-bold text-brand flex items-center gap-1.5">
                    <span>✨</span>
                    <span>특전 {cleanedProgram.length}가지 둘러보기</span>
                  </span>
                  <span className="text-xs font-semibold text-brand">
                    {programExpanded ? '▲ 접기' : '▼ 펼치기'}
                  </span>
                </button>
                {programExpanded && (
                  <ul className="mt-3 space-y-1.5 pl-1">
                    {cleanedProgram.map((item, i) => (
                      <li
                        key={i}
                        className="text-sm text-text-primary flex gap-2 leading-relaxed"
                      >
                        <span className="shrink-0 text-brand mt-0.5">•</span>
                        <span className="break-keep">{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p
                className={`${
                  view.inclusions.basic.length > 0
                    ? 'mt-1.5 pt-1.5 border-t border-blue-100'
                    : ''
                } text-[10px] text-admin-muted leading-snug break-keep`}
              >
                ✅ {cleanedProgram.join(', ')}
              </p>
            ))}
        </div>
      )}

      {hasExcludes && (
        <div
          className={
            isMobile
              ? `bg-red-50/30 ${sectionPad}`
              : `bg-red-50/60 ${sectionPad}`
          }
        >
          <h3 className={`${titleCls} text-red-800`}>❌ 불포함 사항</h3>
          {isMobile ? (
            <ul className="space-y-1.5">
              {excludeLines.map((item, i) => (
                <li
                  key={i}
                  className={`${bodyCls} text-red-700 flex gap-2`}
                >
                  <span className="shrink-0 text-red-300">•</span>
                  <span>{formatTermLine(item)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={`${bodyCls} text-admin-text-2`}>
              {excludeLines.map((item, idx) => (
                <span key={idx}>
                  {idx > 0 && (
                    <span className="mx-1 text-admin-muted-2">|</span>
                  )}
                  {formatTermLine(item)}
                </span>
              ))}
            </p>
          )}
        </div>
      )}

      {hasSurcharges && (
        <div
          className={
            isMobile
              ? `bg-orange-50/50 ${sectionPad}`
              : `bg-orange-50/60 ${sectionPad}`
          }
        >
          <h3 className={`${titleCls} text-orange-800`}>
            💲 {hasPeriod ? '기간별 추가 요금' : '추가 요금'}
          </h3>
          <ul className={isMobile ? 'space-y-1.5' : 'space-y-0.5'}>
            {view.surchargesMerged.map((s, i) => {
              const line = s.display ?? { text: s.label, slug: null, remainder: null };
              return (
                <li
                  key={i}
                  className={`${bodyCls} text-orange-800 flex gap-2`}
                >
                  <span className="shrink-0 text-orange-300">•</span>
                  {s.structured && !s.display?.slug ? (
                    <span>
                      <b>{s.name || '추가요금'}</b>
                      {s.period && (
                        <span className="text-orange-600"> ({s.period})</span>
                      )}
                      {s.priceLabel && (
                        <span className="font-semibold">: {s.priceLabel}</span>
                      )}
                    </span>
                  ) : (
                    <span>{formatTermLine(line)}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {hasPeriod && isMobile && (
            <p className="text-[11px] text-orange-600 mt-2 italic">
              ※ 위 기간 출발 시 1박당 해당 금액이 추가됩니다.
            </p>
          )}
        </div>
      )}

      {hasShopping && (
        <div
          className={
            isMobile
              ? `bg-brand-light/50 ${sectionPad}`
              : `bg-purple-50/60 ${sectionPad}`
          }
        >
          <h3
            className={`${titleCls} ${
              isMobile ? 'text-text-primary mb-2' : 'text-purple-900 mb-0.5'
            }`}
          >
            🛍️ 쇼핑센터
          </h3>
          <p className={`${bodyCls} text-text-primary`}>{shoppingLine}</p>
        </div>
      )}

      {hasMisc && (
        <div
          className={
            isMobile
              ? `bg-gray-50 ${sectionPad}`
              : `bg-admin-bg ${sectionPad}`
          }
        >
          <h3
            className={`${titleCls} ${
              isMobile ? 'text-gray-700 mb-2' : 'text-admin-text-2 mb-1'
            }`}
          >
            📋 기타 안내
          </h3>
          <ul className={isMobile ? 'space-y-1.5' : 'space-y-0.5'}>
            {view.termsMisc.items.map((note, i) => (
              <li
                key={i}
                className={`${bodyCls} ${
                  isMobile ? 'text-gray-600' : 'text-admin-muted'
                } flex gap-2`}
              >
                <span className="shrink-0 opacity-50">•</span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
