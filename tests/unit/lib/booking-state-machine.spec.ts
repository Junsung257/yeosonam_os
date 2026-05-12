import { describe, it, expect } from 'vitest';
import { ALLOWED_TRANSITIONS } from '@/lib/booking-state-machine';

describe('Booking State Machine', () => {
  describe('ALLOWED_TRANSITIONS', () => {
    it('should allow transition from pending to waiting_deposit', () => {
      const allowedStates = ALLOWED_TRANSITIONS['pending'];
      expect(allowedStates).toContain('waiting_deposit');
    });

    it('should allow transition from waiting_deposit to deposit_paid', () => {
      const allowedStates = ALLOWED_TRANSITIONS['waiting_deposit'];
      expect(allowedStates).toContain('deposit_paid');
    });

    it('should allow transition from any state to cancelled', () => {
      Object.keys(ALLOWED_TRANSITIONS).forEach(state => {
        if (state !== 'cancelled') {
          const allowedStates = ALLOWED_TRANSITIONS[state];
          expect(allowedStates).toContain('cancelled');
        }
      });
    });

    it('should not allow transition from fully_paid back to pending', () => {
      const allowedStates = ALLOWED_TRANSITIONS['fully_paid'];
      expect(allowedStates).not.toContain('pending');
    });

    it('should handle all required booking states', () => {
      const requiredStates = [
        'pending',
        'waiting_deposit',
        'deposit_paid',
        'waiting_balance',
        'fully_paid',
        'cancelled',
      ];

      requiredStates.forEach(state => {
        expect(ALLOWED_TRANSITIONS).toHaveProperty(state);
        expect(Array.isArray(ALLOWED_TRANSITIONS[state as any])).toBe(true);
      });
    });
  });
});
