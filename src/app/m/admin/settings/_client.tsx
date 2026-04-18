'use client';

import { useRouter } from 'next/navigation';
import { BellRing, BellOff, LogOut } from 'lucide-react';
import { usePushSubscription } from '@/hooks/usePushSubscription';

export default function SettingsClient() {
  const router = useRouter();
  const { status, error, subscribe, unsubscribe } = usePushSubscription();

  async function logout() {
    await fetch('/api/auth/session', { method: 'DELETE' });
    router.replace('/m/admin/login');
  }

  return (
    <>
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-xs font-semibold text-slate-500">알림</h3>
        </div>

        <div className="px-4 py-3">
          {status === 'unsupported' && (
            <p className="text-xs text-slate-500">
              이 브라우저는 Web Push 를 지원하지 않습니다. iOS 는 홈 화면에 추가한 뒤에만 동작합니다.
            </p>
          )}
          {status === 'denied' && (
            <p className="text-xs text-rose-600">
              알림 권한이 차단되었습니다. 브라우저 설정에서 허용으로 변경하세요.
            </p>
          )}
          {status === 'idle' && (
            <button
              type="button"
              onClick={subscribe}
              className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white rounded-xl px-4 py-3 text-sm font-medium active:scale-[0.99]"
            >
              <BellRing size={16} />
              푸시 알림 켜기
            </button>
          )}
          {status === 'subscribing' && (
            <div className="text-sm text-slate-500">구독 중...</div>
          )}
          {status === 'subscribed' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-emerald-700">
                <BellRing size={16} />
                알림이 켜져 있습니다
              </div>
              <button
                type="button"
                onClick={unsubscribe}
                className="w-full flex items-center justify-center gap-2 bg-slate-100 text-slate-700 rounded-xl px-4 py-2.5 text-xs font-medium active:scale-[0.99]"
              >
                <BellOff size={14} />
                알림 끄기
              </button>
            </div>
          )}
          {status === 'error' && (
            <p className="text-xs text-rose-600">{error ?? '알림 설정 실패'}</p>
          )}
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-xs font-semibold text-slate-500">계정</h3>
        </div>
        <div className="px-4 py-3">
          <button
            type="button"
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 bg-rose-50 text-rose-700 rounded-xl px-4 py-3 text-sm font-medium active:scale-[0.99]"
          >
            <LogOut size={16} />
            로그아웃
          </button>
        </div>
      </section>

      <div className="text-[11px] text-slate-400 text-center pt-2">
        한 번 로그인하면 본인 폰에서 최대 365일 유지됩니다.
      </div>
    </>
  );
}
