import AdminLayout from '@/components/AdminLayout';
import { ToastProvider } from '@/components/ui/Toast';

// Next 15: 정적 평가만 가능. 항상 'auto' (운영 동작 유지).
export const dynamic = 'auto';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <AdminLayout>{children}</AdminLayout>
    </ToastProvider>
  );
}
