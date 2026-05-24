import { ReactNode } from 'react';
import ContentSubNav from './ContentSubNav';

export default function ContentLayout({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-7xl mx-auto px-2 py-4 space-y-4">
      <ContentSubNav />
      {children}
    </div>
  );
}
