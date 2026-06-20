export const GROUP_INQUIRY_PRODUCT_LABEL = '단체 맞춤 견적';

export function buildGroupInquiryHandoffHref({
  source,
  intent = 'group_trip',
  partyType = 'group',
  query = '단체 맞춤 견적 상담',
  destination,
  budget,
  selectedProducts = [GROUP_INQUIRY_PRODUCT_LABEL],
}: {
  source: string;
  intent?: string;
  partyType?: string;
  query?: string;
  destination?: string | null;
  budget?: string | null;
  selectedProducts?: string[];
}) {
  const params = new URLSearchParams({
    source,
    intent,
    party_type: partyType,
    selected_products: selectedProducts.join(','),
    query,
  });

  if (destination) params.set('destination', destination);
  if (budget) params.set('budget', budget);
  return `/group-inquiry?${params.toString()}`;
}

export function buildConciergeHandoffHref({
  source,
  intent = 'package_search',
  partyType,
  query = '패키지 조건 AI 상담',
  destination,
  budget,
  selectedProducts = [],
}: {
  source: string;
  intent?: string;
  partyType?: string | null;
  query?: string;
  destination?: string | null;
  budget?: string | null;
  selectedProducts?: string[];
}) {
  const params = new URLSearchParams({
    source,
    intent,
    query,
  });

  if (partyType) params.set('party_type', partyType);
  if (destination) params.set('destination', destination);
  if (budget) params.set('budget', budget);
  if (selectedProducts.length > 0) params.set('selected_products', selectedProducts.join(','));
  return `/concierge?${params.toString()}`;
}
