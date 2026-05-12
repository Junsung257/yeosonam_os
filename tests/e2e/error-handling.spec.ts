import { test, expect } from '@playwright/test';

test.describe('Error Handling & Resilience E2E', () => {
  test('should gracefully handle network timeout during booking submission', async ({
    page,
  }) => {
    await page.goto('/packages');
    await page.waitForLoadState('networkidle');

    // Simulate slow network
    const context = page.context();
    await context.setExtraHTTPHeaders({
      'x-test-network-delay': '30000', // 30 second delay
    });

    // Start booking flow
    const packageCard = page.locator('[data-testid="package-card"]').first();
    await packageCard.click();

    const bookButton = page.locator('[data-testid="book-package-btn"]');
    await bookButton.click();

    // Fill form
    await page.fill('[data-testid="customer-name"]', 'John Doe');
    await page.fill('[data-testid="customer-email"]', 'john@example.com');

    // Try to submit with timeout
    const reviewButton = page.locator('[data-testid="review-booking-btn"]');
    await reviewButton.click();

    // Verify timeout error is displayed
    const timeoutError = page.locator('[data-testid="timeout-error"]');
    await expect(timeoutError).toBeVisible({ timeout: 35000 });

    // Verify retry button is available
    const retryButton = page.locator('[data-testid="retry-btn"]');
    await expect(retryButton).toBeVisible();
    await expect(retryButton).toBeEnabled();

    // Verify form data is preserved
    const nameInput = page.locator('[data-testid="customer-name"]');
    const savedName = await nameInput.inputValue();
    expect(savedName).toBe('John Doe');
  });

  test('should handle invalid input with specific error messages', async ({ page }) => {
    await page.goto('/packages');
    const packageCard = page.locator('[data-testid="package-card"]').first();
    await packageCard.click();

    const bookButton = page.locator('[data-testid="book-package-btn"]');
    await bookButton.click();

    // Test various invalid inputs
    const testCases = [
      {
        field: '[data-testid="customer-email"]',
        value: 'not-an-email',
        expectedError: '[data-testid="email-error"]',
        expectedText: '유효한 이메일',
      },
      {
        field: '[data-testid="customer-phone"]',
        value: '123',
        expectedError: '[data-testid="phone-error"]',
        expectedText: '전화번호',
      },
      {
        field: '[data-testid="adult-count"]',
        value: '0',
        expectedError: '[data-testid="guest-count-error"]',
        expectedText: '최소 1명',
      },
    ];

    for (const testCase of testCases) {
      // Fill invalid input
      await page.fill(testCase.field, testCase.value);

      // Trigger validation
      await page.locator(testCase.field).blur();

      // Verify error message
      const errorMsg = page.locator(testCase.expectedError);
      await expect(errorMsg).toBeVisible();
      await expect(errorMsg).toContainText(testCase.expectedText);

      // Clear for next test
      await page.fill(testCase.field, '');
    }
  });

  test('should handle concurrent booking attempts on same package', async ({
    page,
    context,
  }) => {
    // Create two pages to simulate concurrent requests
    const page2 = await context.newPage();

    await page.goto('/packages');
    await page2.goto('/packages');

    // Both select same package
    const pkg = page.locator('[data-testid="package-card"]').first();
    const pkgId = await pkg.getAttribute('data-package-id');

    await pkg.click();
    const bookBtn1 = page.locator('[data-testid="book-package-btn"]');
    await bookBtn1.click();

    const pkg2 = page2.locator(`[data-testid="package-card"][data-package-id="${pkgId}"]`);
    await pkg2.click();
    const bookBtn2 = page2.locator('[data-testid="book-package-btn"]');
    await bookBtn2.click();

    // Both fill forms and try to submit simultaneously
    await page.fill('[data-testid="customer-name"]', 'User 1');
    await page.fill('[data-testid="customer-email"]', 'user1@example.com');
    await page.fill('[data-testid="customer-phone"]', '01012345678');

    await page2.fill('[data-testid="customer-name"]', 'User 2');
    await page2.fill('[data-testid="customer-email"]', 'user2@example.com');
    await page2.fill('[data-testid="customer-phone"]', '01087654321');

    // Submit both
    const reviewBtn1 = page.locator('[data-testid="review-booking-btn"]');
    const reviewBtn2 = page2.locator('[data-testid="review-booking-btn"]');

    await Promise.all([reviewBtn1.click(), reviewBtn2.click()]);

    // Both should succeed (no inventory conflict)
    await expect(page.locator('[data-testid="booking-summary"]')).toBeVisible({ timeout: 10000 });
    await expect(page2.locator('[data-testid="booking-summary"]')).toBeVisible({ timeout: 10000 });

    await page2.close();
  });

  test('should recover from server error during checkout', async ({ page }) => {
    await page.goto('/packages');

    // Set up route interception to simulate server errors
    let requestCount = 0;
    await page.route('**/api/bookings', async (route) => {
      requestCount++;
      if (requestCount === 1) {
        // First request fails
        await route.abort('failed');
      } else {
        // Second request succeeds
        await route.continue();
      }
    });

    const packageCard = page.locator('[data-testid="package-card"]').first();
    await packageCard.click();

    const bookButton = page.locator('[data-testid="book-package-btn"]');
    await bookButton.click();

    // Fill form
    await page.fill('[data-testid="customer-name"]', 'John Doe');
    await page.fill('[data-testid="customer-email"]', 'john@example.com');
    await page.fill('[data-testid="customer-phone"]', '01012345678');

    // First submission attempt fails
    const reviewButton = page.locator('[data-testid="review-booking-btn"]');
    await reviewButton.click();

    // Verify error notification
    const errorNotification = page.locator('[data-testid="server-error-notification"]');
    await expect(errorNotification).toBeVisible();

    // Verify retry button appears
    const retryButton = page.locator('[data-testid="retry-btn"]');
    await expect(retryButton).toBeVisible();

    // Retry succeeds
    await retryButton.click();

    // Should now show booking summary
    await expect(page.locator('[data-testid="booking-summary"]')).toBeVisible({ timeout: 10000 });
  });

  test('should handle missing required fields in response data', async ({ page }) => {
    // Set up route to return incomplete data
    await page.route('**/api/packages/*', async (route) => {
      const response = await route.fetch();
      let json = await response.json();

      // Remove required field
      if (json.data) {
        delete json.data.destination;
      }

      await route.fulfill({ response, body: JSON.stringify(json) });
    });

    await page.goto('/packages');
    const packageCard = page.locator('[data-testid="package-card"]').first();

    // Should handle gracefully
    await packageCard.click({ timeout: 10000 });

    // Verify error is shown to user
    const dataError = page.locator('[data-testid="data-validation-error"]');

    if (await dataError.isVisible()) {
      await expect(dataError).toContainText('데이터');
    } else {
      // Or should show fallback UI
      const fallbackMsg = page.locator('[data-testid="fallback-message"]');
      await expect(fallbackMsg).toBeVisible();
    }
  });

  test('should prevent double submission on rapid button clicks', async ({ page }) => {
    await page.goto('/packages');

    // Monitor booking requests
    let bookingRequestCount = 0;
    await page.route('**/api/bookings', async (route) => {
      bookingRequestCount++;
      await route.continue();
    });

    const packageCard = page.locator('[data-testid="package-card"]').first();
    await packageCard.click();

    const bookButton = page.locator('[data-testid="book-package-btn"]');
    await bookButton.click();

    // Fill form
    await page.fill('[data-testid="customer-name"]', 'John Doe');
    await page.fill('[data-testid="customer-email"]', 'john@example.com');
    await page.fill('[data-testid="customer-phone"]', '01012345678');

    // Rapidly click submit button multiple times
    const reviewButton = page.locator('[data-testid="review-booking-btn"]');
    for (let i = 0; i < 5; i++) {
      await reviewButton.click({ timeout: 1000 }).catch(() => {});
    }

    // Wait for all requests to complete
    await page.waitForLoadState('networkidle');

    // Should only send one request despite multiple clicks
    expect(bookingRequestCount).toBe(1);

    // Verify button is disabled after first click
    const isDisabled = await reviewButton.isDisabled();
    expect(isDisabled).toBe(true);
  });

  test('should display helpful error messages for validation failures', async ({
    page,
  }) => {
    await page.goto('/packages');

    // Intercept to return validation errors
    await page.route('**/api/bookings', async (route) => {
      await route.abort();
    });

    const packageCard = page.locator('[data-testid="package-card"]').first();
    await packageCard.click();

    const bookButton = page.locator('[data-testid="book-package-btn"]');
    await bookButton.click();

    // Submit with minimal data
    const reviewButton = page.locator('[data-testid="review-booking-btn"]');
    await reviewButton.click();

    // Verify validation errors are specific and actionable
    const errorList = page.locator('[data-testid="validation-error-item"]');
    const count = await errorList.count();

    expect(count).toBeGreaterThanOrEqual(1);

    // Each error should have helpful message
    for (let i = 0; i < count; i++) {
      const error = errorList.nth(i);
      const message = await error.textContent();

      // Should indicate what's wrong and what's needed
      expect(message).toMatch(/(필수|입력|확인|선택)/);
    }
  });

  test('should auto-save form progress to prevent data loss', async ({ page }) => {
    await page.goto('/packages');

    const packageCard = page.locator('[data-testid="package-card"]').first();
    await packageCard.click();

    const bookButton = page.locator('[data-testid="book-package-btn"]');
    await bookButton.click();

    // Fill form partially
    await page.fill('[data-testid="customer-name"]', 'John Doe');
    await page.fill('[data-testid="customer-email"]', 'john@example.com');

    // Wait for auto-save
    await page.waitForTimeout(2000);

    // Navigate away
    await page.goto('/packages');
    await page.waitForLoadState('networkidle');

    // Come back to booking
    await packageCard.click();
    await bookButton.click();

    // Verify data is restored
    const nameValue = await page.locator('[data-testid="customer-name"]').inputValue();
    const emailValue = await page.locator('[data-testid="customer-email"]').inputValue();

    expect(nameValue).toBe('John Doe');
    expect(emailValue).toBe('john@example.com');

    // Verify auto-save indicator was shown
    const autoSaveMsg = page.locator('[data-testid="auto-save-indicator"]');
    await expect(autoSaveMsg).toBeVisible({ timeout: 5000 });
  });
});
