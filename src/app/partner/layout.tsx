import type { ReactNode } from "react";
import { PartnerShell } from "@/components/partner/PartnerShell";

export default function PartnerLayout({ children }: { children: ReactNode }) {
  return <PartnerShell>{children}</PartnerShell>;
}
