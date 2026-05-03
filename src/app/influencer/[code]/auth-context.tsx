'use client';

import { createContext, useContext } from 'react';

interface AffiliateInfo {
  id: string;
  name: string;
  referral_code: string;
  grade: number;
  grade_label: string;
  grade_rate: string;
  logo_url?: string;
}

interface AuthCtx {
  affiliate: AffiliateInfo | null;
  authenticated: boolean;
  setAuth: (a: AffiliateInfo) => void;
  clearAuth: () => void;
}

export const InfluencerAuthContext = createContext<AuthCtx>({
  affiliate: null,
  authenticated: false,
  setAuth: () => {},
  clearAuth: () => {},
});

export const useInfluencerAuth = () => useContext(InfluencerAuthContext);

export type { AffiliateInfo };
