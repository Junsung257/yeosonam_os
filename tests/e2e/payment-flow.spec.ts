import { test, expect } from '@playwright/test';

test.describe('Payment Flow E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/bookings');
    await page.waitForLoadState('networkidle');
  });

  test('should complete full payment flow (deposit → balance → paid)', async ({
    page,
  }) => {
    // Step 1: Find a booking in pending status
    const pendingBooking = page.locator('[data-testid="booking-row"][data-status="pending"]').first();
    await expect(pendingBooking).toBeVisible();
    await pendingBooking.click();

    // Step 2: Navigate to payment section
    const paymentTab = page.locator('[data-testid="payment-tab"]');
    await paymentTab.click();

    // Step 3: Record booking ID and total price
    const bookingId = await page.locator('[data-testid="booking-id"]').textContent();
    const totalPrice = await page.locator('[data-testid="total-price"]').textContent();

    // Step 4: Submit deposit payment
    const depositAmount = page.locator('[data-testid="deposit-amount"]');
    const depositInput = await depositAmount.inputValue();

    const paymentMethodSelect = page.locator('[data-testid="payment-method"]');
    await paymentMethodSelect.selectOption('shinhan'); // 신한은행

    const submitDepositBtn = page.locator('[data-testid="submit-deposit-btn"]');
    await submitDepositBtn.click();

    // Step 5: Verify deposit recorded
    await expect(page.locator('[data-testid="status-badge"]')).toContainText('waiting_balance');
    await expect(page.locator('[data-testid="deposit-paid"]')).toContainText('₩');
    await expect(page.locator('[data-testid="balance-due"]')).toBeVisible();

    // Step 6: Submit balance payment
    const balanceInput = page.locator('[data-testid="balance-input"]');
    const balanceAmount = await balanceInput.inputValue();

    const submitBalanceBtn = page.locator('[data-testid="submit-balance-btn"]');
    await submitBalanceBtn.click();

    // Step 7: Verify full payment completed
    await expect(page.locator('[data-testid="status-badge"]')).toContainText('fully_paid');
    await expect(page.locator('[data-testid="payment-completed-msg"]')).toContainText('결제가 완료되었습니다');
  });

  test('should auto-match payment with high confidence', async ({ page }) => {
    // Navigate to payment matching dashboard
    await page.goto('/admin/payments');
    await page.waitForLoadState('networkidle');

    // Find unmatched payment with high confidence score (≥90%)
    const highConfidencePayment = page
      .locator('[data-testid="unmatched-payment"]')
      .filter({ has: page.locator('[data-testid="confidence-score"]:has-text("90")') })
      .first();

    await expect(highConfidencePayment).toBeVisible();

    // Click to view details
    await highConfidencePayment.click();

    // Verify matching suggestion is shown
    const suggestedBooking = page.locator('[data-testid="suggested-booking"]');
    await expect(suggestedBooking).toBeVisible();

    // Click auto-match button
    const autoMatchBtn = page.locator('[data-testid="auto-match-btn"]');
    await autoMatchBtn.click();

    // Verify match success
    await expect(page.locator('[data-testid="match-success-msg"]')).toContainText('매칭되었습니다');

    // Verify payment status changed to matched
    await expect(page.locator('[data-testid="payment-status"]')).toContainText('matched');
  });

  test('should require manual review for medium confidence matches (60-89%)', async ({
    page,
  }) => {
    await page.goto('/admin/payments');
    await page.waitForLoadState('networkidle');

    // Find payment with medium confidence (60-89%)
    const mediumConfidencePayment = page
      .locator('[data-testid="unmatched-payment"]')
      .filter({ has: page.locator('[data-testid="confidence-score"]:has-text("75")') })
      .first();

    await mediumConfidencePayment.click();

    // Verify auto-match button is disabled
    const autoMatchBtn = page.locator('[data-testid="auto-match-btn"]');
    await expect(autoMatchBtn).toBeDisabled();

    // Verify manual review required message
    await expect(page.locator('[data-testid="manual-review-required"]')).toBeVisible();

    // Verify suggest multiple bookings
    const suggestedBookings = page.locator('[data-testid="suggested-booking"]');
    const count = await suggestedBookings.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Select correct booking manually
    const correctBooking = suggestedBookings.first();
    await correctBooking.click();

    // Confirm match
    const confirmMatchBtn = page.locator('[data-testid="confirm-match-btn"]');
    await confirmMatchBtn.click();

    // Verify match recorded
    await expect(page.locator('[data-testid="match-success-msg"]')).toBeVisible();
  });

  test('should prevent auto-match for low confidence (<60%)', async ({ page }) => {
    await page.goto('/admin/payments');
    await page.waitForLoadState('networkidle');

    // Find low confidence payment (<60%)
    const lowConfidencePayment = page
      .locator('[data-testid="unmatched-payment"]')
      .filter({ has: page.locator('[data-testid="confidence-score"]:has-text("45")') })
      .first();

    await lowConfidencePayment.click();

    // Verify auto-match button is disabled
    const autoMatchBtn = page.locator('[data-testid="auto-match-btn"]');
    await expect(autoMatchBtn).toBeDisabled();

    // Verify low confidence warning
    await expect(page.locator('[data-testid="low-confidence-warning"]')).toBeVisible();
    await expect(page.locator('[data-testid="low-confidence-warning"]')).toContainText('정확도 낮음');

    // Verify manual review is required
    await expect(page.locator('[data-testid="manual-review-required"]')).toBeVisible();
  });

  test('should allow manual unmatching of incorrectly matched payments', async ({
    page,
  }) => {
    await page.goto('/admin/payments');
    await page.waitForLoadState('networkidle');

    // Find a matched payment
    const matchedPayment = page.locator('[data-testid="matched-payment"]').first();
    await matchedPayment.click();

    // Verify booking is shown
    const linkedBooking = page.locator('[data-testid="linked-booking"]');
    await expect(linkedBooking).toBeVisible();

    // Click unmatch button
    const unmatchBtn = page.locator('[data-testid="unmatch-btn"]');
    await unmatchBtn.click();

    // Verify confirmation dialog
    await expect(page.locator('[data-testid="confirm-unmatch-dialog"]')).toBeVisible();

    // Confirm unmatch
    const confirmUnmatchBtn = page.locator('[data-testid="confirm-unmatch-btn"]');
    await confirmUnmatchBtn.click();

    // Verify unmatched status
    await expect(page.locator('[data-testid="payment-status"]')).toContainText('unmatched');
  });

  test('should record payment journal entries on every state change', async ({
    page,
  }) => {
    await page.goto('/admin/bookings');
    const pendingBooking = page.locator('[data-testid="booking-row"][data-status="pending"]').first();
    await pendingBooking.click();

    // Navigate to payment history
    const paymentHistoryTab = page.locator('[data-testid="payment-history-tab"]');
    await paymentHistoryTab.click();

    // Get initial history count
    const historyItems = page.locator('[data-testid="history-item"]');
    const initialCount = await historyItems.count();

    // Go back to payment tab and submit deposit
    const paymentTab = page.locator('[data-testid="payment-tab"]');
    await paymentTab.click();

    const submitDepositBtn = page.locator('[data-testid="submit-deposit-btn"]');
    await submitDepositBtn.click();

    // Return to payment history
    await paymentHistoryTab.click();

    // Verify new entry added
    const updatedCount = await historyItems.count();
    expect(updatedCount).toBe(initialCount + 1);

    // Verify latest entry shows deposit payment
    const latestEntry = page.locator('[data-testid="history-item"]').first();
    await expect(latestEntry).toContainText('입금');
    await expect(latestEntry).toContainText('waiting_balance');
  });

  test('should reject overpayment attempts', async ({ page }) => {
    await page.goto('/admin/bookings');
    const pendingBooking = page.locator('[data-testid="booking-row"][data-status="pending"]').first();
    await pendingBooking.click();

    const paymentTab = page.locator('[data-testid="payment-tab"]');
    await paymentTab.click();

    // Get total price
    const totalPrice = await page.locator('[data-testid="total-price"]').textContent();
    const total = parseInt(totalPrice?.replace(/[^0-9]/g, '') || '0');

    // Try to submit payment exceeding total
    const depositInput = page.locator('[data-testid="deposit-input"]');
    const overpayment = (total * 1.2).toString();
    await depositInput.fill(overpayment);

    // Try to submit
    const submitBtn = page.locator('[data-testid="submit-deposit-btn"]');
    await submitBtn.click();

    // Verify error
    await expect(page.locator('[data-testid="overpayment-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="overpayment-error"]')).toContainText('초과');
  });

  test('should handle booking cancellation with refund calculation', async ({
    page,
  }) => {
    await page.goto('/admin/bookings');

    // Find fully paid booking
    const paidBooking = page
      .locator('[data-testid="booking-row"]')
      .filter({ has: page.locator('[data-testid="status-badge"]:has-text("fully_paid")') })
      .first();

    await paidBooking.click();

    // Click cancel button
    const cancelBtn = page.locator('[data-testid="cancel-booking-btn"]');
    await cancelBtn.click();

    // Verify cancellation dialog
    await expect(page.locator('[data-testid="cancel-confirmation-dialog"]')).toBeVisible();

    // Verify refund calculation is shown
    const refundAmount = page.locator('[data-testid="refund-amount"]');
    await expect(refundAmount).toBeVisible();
    await expect(refundAmount).toContainText('₩');

    // Confirm cancellation
    const confirmCancelBtn = page.locator('[data-testid="confirm-cancel-btn"]');
    await confirmCancelBtn.click();

    // Verify status changed to cancelled
    await expect(page.locator('[data-testid="status-badge"]')).toContainText('cancelled');

    // Verify refund marked for processing
    await expect(page.locator('[data-testid="refund-status"]')).toContainText('pending_refund');
  });
});
