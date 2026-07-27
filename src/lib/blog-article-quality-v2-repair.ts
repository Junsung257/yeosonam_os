export function repairArticleQualityV2Specifics(
  markdown: string,
  blogType: 'product' | 'info',
): { markdown: string; changes: string[] } {
  let next = markdown;
  const changes: string[] = [];

  const staleDateRepaired = next.replace(
    /20\d{2}년\s*\d{1,2}월\s*\d{1,2}일\s*확인\s*기준/g,
    '출발 전 공식 안내 재확인 기준',
  );
  if (staleDateRepaired !== next) {
    next = staleDateRepaired;
    changes.push('article_v2_stale_confirmation_date_repaired');
  }

  const internalClaimRepaired = next
    .replace(/여소남\s*내부\s*(?:상품\/예약|예약|상품)?\s*데이터\s*기준/g, '등록된 상품 정보 기준')
    .replace(/여소남\s*(?:상품\/예약|예약|상품)?\s*데이터\s*기준/g, '등록된 상품 정보 기준')
    .replace(/여소남\s*데이터/g, '등록된 상품 정보');
  if (internalClaimRepaired !== next) {
    next = internalClaimRepaired;
    changes.push('article_v2_unsupported_internal_claim_repaired');
  }

  const readableInternalClaimRepaired = next
    .replace(/여소남\s*검토\s*상품\s*가격대/g, '확인 가능한 상품 가격대')
    .replace(/여소남\s*검토/g, '공개 정보 기준');
  if (readableInternalClaimRepaired !== next) {
    next = readableInternalClaimRepaired;
    changes.push('article_v2_unsupported_internal_claim_repaired');
  }

  if (blogType === 'info') {
    const lines = next.split('\n');
    const upperLimit = Math.min(lines.length, Math.max(12, Math.floor(lines.length * 0.3)));
    let removed = 0;
    for (let index = 0; index < upperLimit; index += 1) {
      const line = lines[index] ?? '';
      if (/(?:카톡|무료\s*상담|관련\s*패키지|상품\s*보기|예약하세요|문의하세요|상담\s*신청|패키지\s*보기)/i.test(line)) {
        lines[index] = '';
        removed += 1;
      }
    }
    if (removed > 0) {
      next = lines.join('\n').replace(/\n{3,}/g, '\n\n');
      changes.push(`article_v2_top_sales_cta_removed_${removed}`);
    }
  }

  return { markdown: next, changes };
}
