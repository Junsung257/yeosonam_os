export interface SelfReferralCheckInput {
  bookingPhone?: string | null;
  bookingEmail?: string | null;
  affiliatePhone?: string | null;
  affiliateEmail?: string | null;
}

export interface SelfReferralResult {
  flagged: boolean;
  reason: string | null;
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return null;
  return digits.slice(-8);
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return email.trim().toLowerCase();
}

export function checkSelfReferral(input: SelfReferralCheckInput): SelfReferralResult {
  const bookingPhoneTail = normalizePhone(input.bookingPhone);
  const affiliatePhoneTail = normalizePhone(input.affiliatePhone);
  if (bookingPhoneTail && affiliatePhoneTail && bookingPhoneTail === affiliatePhoneTail) {
    return { flagged: true, reason: 'PHONE_MATCH' };
  }

  const bookingEmail = normalizeEmail(input.bookingEmail);
  const affiliateEmail = normalizeEmail(input.affiliateEmail);
  if (bookingEmail && affiliateEmail && bookingEmail === affiliateEmail) {
    return { flagged: true, reason: 'EMAIL_MATCH' };
  }

  return { flagged: false, reason: null };
}
