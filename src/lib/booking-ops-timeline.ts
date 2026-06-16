type BookingOpsTimelineKind =
  | 'booking'
  | 'payment'
  | 'task'
  | 'message'
  | 'settlement';

export type BookingOpsTimelineTone =
  | 'slate'
  | 'blue'
  | 'emerald'
  | 'amber'
  | 'red'
  | 'purple';

export interface BookingOpsTimelineItem {
  id: string;
  kind: BookingOpsTimelineKind;
  at: string;
  title: string;
  detail: string | null;
  tone: BookingOpsTimelineTone;
  href?: string | null;
}

export interface BookingOpsTimelineResponse {
  bookingId: string;
  generatedAt: string;
  items: BookingOpsTimelineItem[];
}

export function sortBookingOpsTimelineItems(
  items: BookingOpsTimelineItem[],
): BookingOpsTimelineItem[] {
  return [...items].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
