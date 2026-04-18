import { MobileHeader } from '@/components/admin/mobile/MobileHeader';
import SettingsClient from './_client';

export const dynamic = 'force-dynamic';

export default function MobileSettingsPage() {
  return (
    <>
      <MobileHeader title="설정" />
      <main className="px-4 py-4 space-y-4">
        <SettingsClient />
      </main>
    </>
  );
}
