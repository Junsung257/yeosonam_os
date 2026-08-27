import type { Metadata } from 'next';

import { ProductReviewNotice } from '@/components/product-review-notice';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: '상품 재검수 안내 | 여소남',
  description: '상품 정보를 재검수하고 있습니다. 정확한 내용은 상담을 통해 안내해 드립니다.',
  robots: { index: false, follow: false, nocache: true },
  openGraph: {
    title: '상품 재검수 안내 | 여소남',
    description: '상품 정보를 재검수하고 있습니다.',
    type: 'website',
    images: [],
  },
  twitter: {
    card: 'summary',
    title: '상품 재검수 안내 | 여소남',
    description: '상품 정보를 재검수하고 있습니다.',
    images: [],
  },
};

export default function ProductReviewPage() {
  return <ProductReviewNotice />;
}

