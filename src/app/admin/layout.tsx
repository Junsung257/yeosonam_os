'use client';

import AdminLayout from '@/components/AdminLayout';
import { ToastProvider } from '@/components/ui/Toast';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <AdminLayout>{children}</AdminLayout>
    </ToastProvider>
  );
}
