/**
 * 장바구니 API — GET / POST / DELETE
 * session_id 기반 (비회원 포함)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCart, upsertCart, isSupabaseConfigured, CartItem } from '@/lib/supabase';

function getSessionId(request: NextRequest): string | null {
  return request.headers.get('x-session-id') ??
         request.nextUrl.searchParams.get('session_id');
}

// GET /api/concierge/cart?session_id=xxx
export async function GET(request: NextRequest) {
  const sessionId = getSessionId(request);
  if (!sessionId) return NextResponse.json({ error: 'session_id 필요' }, { status: 400 });
  if (!isSupabaseConfigured) return NextResponse.json({ items: [] });

  const cart = await getCart(sessionId);
  return NextResponse.json({ items: cart?.items ?? [] });
}

// POST /api/concierge/cart  body: { session_id, item }  or  { session_id, items }
export async function POST(request: NextRequest) {
  const body = await request.json();
  const sessionId: string = body.session_id;
  if (!sessionId) return NextResponse.json({ error: 'session_id 필요' }, { status: 400 });
  if (!isSupabaseConfigured) return NextResponse.json({ items: [] });

  const cart = await getCart(sessionId);
  const existing: CartItem[] = cart?.items ?? [];

  if (body.items) {
    // 전체 교체
    const updated = await upsertCart(sessionId, body.items as CartItem[]);
    return NextResponse.json({ items: updated?.items ?? body.items });
  }

  if (body.item) {
    const newItem: CartItem = body.item;
    // 같은 product_id 있으면 quantity += 1
    const idx = existing.findIndex(i => i.product_id === newItem.product_id);
    let updated: CartItem[];
    if (idx >= 0) {
      updated = existing.map((i, index) =>
        index === idx ? { ...i, quantity: i.quantity + 1 } : i
      );
    } else {
      updated = [...existing, { ...newItem, quantity: newItem.quantity ?? 1 }];
    }
    const result = await upsertCart(sessionId, updated);
    return NextResponse.json({ items: result?.items ?? updated });
  }

  return NextResponse.json({ error: 'item 또는 items 필요' }, { status: 400 });
}

// DELETE /api/concierge/cart  body: { session_id, product_id } 또는 { session_id } (전체 삭제)
export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const sessionId: string = body.session_id;
  if (!sessionId) return NextResponse.json({ error: 'session_id 필요' }, { status: 400 });
  if (!isSupabaseConfigured) return NextResponse.json({ items: [] });

  if (body.product_id) {
    const cart = await getCart(sessionId);
    const existing: CartItem[] = cart?.items ?? [];
    const updated = existing.filter(i => i.product_id !== body.product_id);
    const result = await upsertCart(sessionId, updated);
    return NextResponse.json({ items: result?.items ?? updated });
  }

  // 전체 비우기
  const result = await upsertCart(sessionId, []);
  return NextResponse.json({ items: result?.items ?? [] });
}
