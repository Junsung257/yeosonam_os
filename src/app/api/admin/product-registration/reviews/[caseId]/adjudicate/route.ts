export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Adjudication uses the same Receipt contract. The database derives the
 * adjudicator slot from the case state and requires a third distinct account.
 */
export { POST } from '../receipt/route';
