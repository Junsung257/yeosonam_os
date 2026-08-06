import { redirect } from 'next/navigation';

export default function LegacyAdminTaxPage() {
  redirect('/admin/finance?tab=tax');
}
