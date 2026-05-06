'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSecret } from '@/lib/secret-registry';

export type PushStatus =
  | 'unsupported'
  | 'denied'
  | 'idle' // 권한 있음, 구독 없음
  | 'subscribed'
  | 'subscribing'
  | 'error';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function usePushSubscription() {
  const [status, setStatus] = useState<PushStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (typeof window === 'undefined') return;
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setStatus('unsupported');
        return;
      }
      if (Notification.permission === 'denied') {
        setStatus('denied');
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (cancelled) return;
        setStatus(sub ? 'subscribed' : 'idle');
      } catch {
        if (!cancelled) setStatus('error');
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, []);

  const subscribe = useCallback(async () => {
    setError(null);
    const vapid = getSecret('NEXT_PUBLIC_VAPID_PUBLIC_KEY');
    if (!vapid) {
      setError('VAPID 공개키가 설정되지 않았습니다.');
      setStatus('error');
      return;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported');
      return;
    }
    try {
      setStatus('subscribing');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setStatus(perm === 'denied' ? 'denied' : 'idle');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapid) as BufferSource,
        }));

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || '구독 저장 실패');
      }
      setStatus('subscribed');
    } catch (e) {
      setError(e instanceof Error ? e.message : '구독 실패');
      setStatus('error');
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setStatus('idle');
        return;
      }
      await sub.unsubscribe();
      await fetch('/api/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      setStatus('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : '해지 실패');
      setStatus('error');
    }
  }, []);

  return { status, error, subscribe, unsubscribe };
}
