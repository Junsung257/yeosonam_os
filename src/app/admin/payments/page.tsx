import { redirect } from 'next/navigation';

export default function PaymentsCompatibilityPage() {
  redirect('/admin/finance?tab=review');
}
