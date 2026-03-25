'use client';
import { useState, useEffect, useCallback } from 'react';

export interface Vendor {
  id: string;
  name: string;
  contact?: string | null;
  regions?: string[] | null;
  is_active: boolean;
}

// ── 모듈 레벨 캐시 (컴포넌트 unmount/remount 시 재fetch 방지) ─────────────────
let _cache: Vendor[] | null = null;
let _cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5분
const _listeners = new Set<(data: Vendor[]) => void>();

async function fetchVendors(): Promise<Vendor[]> {
  const now = Date.now();
  if (_cache && now - _cacheTs < CACHE_TTL) return _cache;
  const res = await fetch('/api/land-operators');
  const json = await res.json();
  _cache = json.operators ?? [];
  _cacheTs = now;
  _listeners.forEach(fn => fn(_cache!));
  return _cache!;
}

export function invalidateVendorCache() {
  _cache = null;
  _cacheTs = 0;
}

/**
 * 전역 랜드사 훅 (모듈 레벨 캐시로 중복 fetch 방지)
 * @param includeInactive true 시 비활성 랜드사도 포함 (관리 페이지용)
 */
export function useVendors(includeInactive = false) {
  const [all, setAll] = useState<Vendor[]>(_cache ?? []);
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    _listeners.add(setAll);
    fetchVendors().then(setAll).finally(() => setLoading(false));
    return () => { _listeners.delete(setAll); };
  }, []);

  // vendors: 활성만 (드롭다운용), all: 전체 (렌더링·관리 페이지용)
  const vendors = includeInactive ? all : all.filter(v => v.is_active !== false);

  const softDelete = useCallback(async (id: string) => {
    const prev = _cache ? [..._cache] : [];
    // Optimistic: 캐시 + 모든 구독자 즉시 업데이트
    _cache = (_cache ?? []).map(v => v.id === id ? { ...v, is_active: false } : v);
    _listeners.forEach(fn => fn(_cache!));
    const res = await fetch('/api/land-operators', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: false }),
    });
    if (!res.ok) {
      // Rollback
      _cache = prev;
      _listeners.forEach(fn => fn(prev));
    }
    return res.ok;
  }, []);

  const restore = useCallback(async (id: string) => {
    const prev = _cache ? [..._cache] : [];
    _cache = (_cache ?? []).map(v => v.id === id ? { ...v, is_active: true } : v);
    _listeners.forEach(fn => fn(_cache!));
    const res = await fetch('/api/land-operators', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: true }),
    });
    if (!res.ok) {
      _cache = prev;
      _listeners.forEach(fn => fn(prev));
    }
    return res.ok;
  }, []);

  const addVendor = useCallback(async (name: string, contact?: string) => {
    const res = await fetch('/api/land-operators', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), contact: contact ?? null }),
    });
    if (!res.ok) return null;
    const { operator } = await res.json();
    _cache = [...(_cache ?? []), operator];
    _cacheTs = Date.now();
    _listeners.forEach(fn => fn(_cache!));
    return operator as Vendor;
  }, []);

  const updateVendor = useCallback(async (id: string, name: string, contact: string | null) => {
    const prev = _cache ? [..._cache] : [];
    _cache = (_cache ?? []).map(v => v.id === id ? { ...v, name, contact } : v);
    _listeners.forEach(fn => fn(_cache!));
    const res = await fetch('/api/land-operators', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, contact }),
    });
    if (!res.ok) {
      _cache = prev;
      _listeners.forEach(fn => fn(prev));
    }
    return res.ok;
  }, []);

  return { vendors, all, loading, softDelete, restore, addVendor, updateVendor };
}
