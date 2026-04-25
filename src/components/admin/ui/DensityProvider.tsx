'use client';

/**
 * DensityProvider — 어드민 ERP 행 밀도 토글
 *
 * - 기본: 'comfortable' (14px, 행 56px) — 사장님 가독성 권고
 * - 'compact' (13px, 행 48px) — 대량 데이터 비교 시
 * - localStorage 키: admin.density
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { Rows3, Rows4 } from 'lucide-react';

export type Density = 'compact' | 'comfortable';

interface DensityCtx {
  density: Density;
  setDensity: (d: Density) => void;
  toggle: () => void;
}

const Ctx = createContext<DensityCtx>({
  density: 'comfortable',
  setDensity: () => {},
  toggle: () => {},
});

const STORAGE_KEY = 'admin.density';

export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<Density>('comfortable');

  // hydrate from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'compact' || saved === 'comfortable') {
      setDensityState(saved);
    }
  }, []);

  const setDensity = useCallback((d: Density) => {
    setDensityState(d);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, d);
    }
  }, []);

  const toggle = useCallback(() => {
    setDensity(density === 'compact' ? 'comfortable' : 'compact');
  }, [density, setDensity]);

  return (
    <Ctx.Provider value={{ density, setDensity, toggle }}>
      {children}
    </Ctx.Provider>
  );
}

export function useDensity() {
  return useContext(Ctx);
}

interface DensityToggleProps {
  className?: string;
}

export function DensityToggle({ className = '' }: DensityToggleProps) {
  const { density, toggle } = useDensity();
  const isCompact = density === 'compact';
  const Icon = isCompact ? Rows4 : Rows3;
  const label = isCompact ? '컴팩트' : '편안함';

  return (
    <button
      type="button"
      onClick={toggle}
      title={`행 밀도: ${label} (클릭하여 ${isCompact ? '편안함' : '컴팩트'}로 전환)`}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-admin-xs text-admin-textMuted hover:text-admin-text hover:bg-slate-100 transition-colors ${className}`}
    >
      <Icon size={14} strokeWidth={2.2} />
      <span>{label}</span>
    </button>
  );
}

export default DensityProvider;
