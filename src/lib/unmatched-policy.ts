import { canCreateAttractionRecord } from '@/lib/attraction-policy';

export function canCreateAttractionViaReconcileAction(): boolean {
  return canCreateAttractionRecord('admin_manual');
}
