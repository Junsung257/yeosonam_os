import { redirect } from 'next/navigation';

export default function LedgerCompatibilityPage() {
  redirect('/admin/finance?tab=home');
}
