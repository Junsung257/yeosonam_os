import { ReactNode } from 'react';
import CardNewsSubNav from './CardNewsSubNav';

export default function CardNewsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-7xl mx-auto px-2 py-4 space-y-4">
      <CardNewsSubNav />
      {children}
    </div>
  );
}
