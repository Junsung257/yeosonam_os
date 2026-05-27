'use client';

import nextDynamic from 'next/dynamic';

const PaymentsClient = nextDynamic(() => import('./_client'), { ssr: false });

export default PaymentsClient;
