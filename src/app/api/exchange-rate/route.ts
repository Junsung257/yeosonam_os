import { NextResponse } from 'next/server';
import { getRateInfo } from '@/lib/exchange-rate';

export async function GET() {
  try {
    const info = await getRateInfo();
    return NextResponse.json(info);
  } catch {
    return NextResponse.json({ rate: 1400, source: 'fallback' });
  }
}
