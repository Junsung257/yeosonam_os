'use client';

import { useEffect, useRef } from 'react';
import { trackEngagement } from '@/lib/tracker';
import {
  buildBlogInformationalCtaEvent,
  type BlogInformationalCtaEventContext,
  type SelectedBlogInformationalCta,
} from '@/lib/blog-informational-cta';

interface Props {
  articleId: string;
  slug: string;
  destinationId: string;
  destination?: string | null;
  intent: BlogInformationalCtaEventContext['intent'];
  locale: string;
  ctas: SelectedBlogInformationalCta[];
}

export function InformationalCtaHub({
  articleId,
  slug,
  destinationId,
  destination,
  intent,
  locale,
  ctas,
}: Props) {
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || ctas.length === 0) return;
    const seen = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.25) continue;
        const link = entry.target as HTMLAnchorElement;
        const ctaKey = link.dataset.ctaKey as SelectedBlogInformationalCta['key'] | undefined;
        const placement = link.dataset.ctaPlacement as SelectedBlogInformationalCta['placement'] | undefined;
        if (!ctaKey || !placement || seen.has(ctaKey)) continue;
        seen.add(ctaKey);
        trackEngagement(buildBlogInformationalCtaEvent('blog_cta_impression', {
          articleId,
          slug,
          destinationId,
          destination,
          intent,
          ctaKey,
          placement,
          locale,
        }));
        observer.unobserve(link);
      }
    }, { threshold: [0.25, 0.5] });

    root.querySelectorAll<HTMLAnchorElement>('a[data-informational-cta="true"]')
      .forEach((link) => observer.observe(link));
    return () => observer.disconnect();
  }, [articleId, ctas, destination, destinationId, intent, locale, slug]);

  if (ctas.length === 0) return null;
  const placement = ctas[0]?.placement ?? 'bottom';

  return (
    <aside
      ref={rootRef}
      data-informational-cta-hub={placement}
      className="not-prose my-10 rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:p-6"
      aria-labelledby={`informational-cta-title-${articleId}`}
    >
      <h2
        id={`informational-cta-title-${articleId}`}
        className="text-lg font-bold text-slate-900"
      >
        다음 여행 준비를 이어가세요
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        위 내용을 먼저 확인한 뒤, 필요한 정보만 선택해 이어서 보세요.
      </p>
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ctas.map((cta) => {
          const externalProps = cta.external
            ? { target: '_blank', rel: 'noopener noreferrer' }
            : {};
          return (
            <a
              key={cta.key}
              href={cta.href}
              {...externalProps}
              data-informational-cta="true"
              data-cta-key={cta.key}
              data-cta-placement={cta.placement}
              onClick={() => {
                trackEngagement(buildBlogInformationalCtaEvent('blog_cta_click', {
                  articleId,
                  slug,
                  destinationId,
                  destination,
                  intent,
                  ctaKey: cta.key,
                  placement: cta.placement,
                  locale,
                }));
              }}
              aria-label={cta.external ? `${cta.label} (새 창)` : cta.label}
              className={cta.role === 'primary'
                ? 'flex min-h-11 w-full flex-col justify-center rounded-xl bg-slate-900 px-4 py-3 text-left text-white transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900'
                : 'flex min-h-11 w-full flex-col justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-left text-slate-900 transition hover:border-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900'}
            >
              <span className="text-sm font-bold">{cta.label}</span>
              <span className={cta.role === 'primary'
                ? 'mt-1 text-xs leading-5 text-slate-200'
                : 'mt-1 text-xs leading-5 text-slate-600'}
              >
                {cta.description}
              </span>
            </a>
          );
        })}
      </div>
    </aside>
  );
}
