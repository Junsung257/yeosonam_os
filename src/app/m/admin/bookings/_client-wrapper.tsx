'use client';

import nextDynamic from 'next/dynamic';

const BookingsClient = nextDynamic(() => import('./_client'), { ssr: false });

export default BookingsClient;
