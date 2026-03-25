'use client';
import { useState, useEffect, useCallback } from 'react';

export interface Location {
  id: string;
  name: string;
  is_active: boolean;
}

// ── 모듈 레벨 캐시 ───────────────────────────────────────────────────────────
let _cache: Location[] | null = null;
let _cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5분
const _listeners = new Set<(data: Location[]) => void>();

async function fetchLocations(): Promise<Location[]> {
  const now = Date.now();
  if (_cache && now - _cacheTs < CACHE_TTL) return _cache;
  const res = await fetch('/api/departing-locations');
  const json = await res.json();
  _cache = json.locations ?? [];
  _cacheTs = now;
  _listeners.forEach(fn => fn(_cache!));
  return _cache!;
}

export function invalidateLocationCache() {
  _cache = null;
  _cacheTs = 0;
}

/**
 * 전역 출발지 훅 (모듈 레벨 캐시로 중복 fetch 방지)
 * @param includeInactive true 시 비활성 출발지도 포함 (관리 페이지용)
 */
export function useLocations(includeInactive = false) {
  const [all, setAll] = useState<Location[]>(_cache ?? []);
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    _listeners.add(setAll);
    fetchLocations().then(setAll).finally(() => setLoading(false));
    return () => { _listeners.delete(setAll); };
  }, []);

  const locations = includeInactive ? all : all.filter(l => l.is_active !== false);

  const softDelete = useCallback(async (id: string) => {
    const prev = _cache ? [..._cache] : [];
    _cache = (_cache ?? []).map(l => l.id === id ? { ...l, is_active: false } : l);
    _listeners.forEach(fn => fn(_cache!));
    const res = await fetch('/api/departing-locations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: false }),
    });
    if (!res.ok) { _cache = prev; _listeners.forEach(fn => fn(prev)); }
    return res.ok;
  }, []);

  const restore = useCallback(async (id: string) => {
    const prev = _cache ? [..._cache] : [];
    _cache = (_cache ?? []).map(l => l.id === id ? { ...l, is_active: true } : l);
    _listeners.forEach(fn => fn(_cache!));
    const res = await fetch('/api/departing-locations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: true }),
    });
    if (!res.ok) { _cache = prev; _listeners.forEach(fn => fn(prev)); }
    return res.ok;
  }, []);

  const addLocation = useCallback(async (name: string) => {
    const res = await fetch('/api/departing-locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) return null;
    const { location } = await res.json();
    _cache = [...(_cache ?? []), location];
    _cacheTs = Date.now();
    _listeners.forEach(fn => fn(_cache!));
    return location as Location;
  }, []);

  const updateLocation = useCallback(async (id: string, name: string) => {
    const prev = _cache ? [..._cache] : [];
    _cache = (_cache ?? []).map(l => l.id === id ? { ...l, name } : l);
    _listeners.forEach(fn => fn(_cache!));
    const res = await fetch('/api/departing-locations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name }),
    });
    if (!res.ok) { _cache = prev; _listeners.forEach(fn => fn(prev)); }
    return res.ok;
  }, []);

  return { locations, all, loading, softDelete, restore, addLocation, updateLocation };
}
