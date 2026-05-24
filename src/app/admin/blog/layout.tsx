import { ReactNode } from 'react';
import BlogSubNav from './BlogSubNav';

export default function BlogLayout({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-7xl mx-auto px-2 py-4 space-y-4">
      <BlogSubNav />
      {children}
    </div>
  );
}
