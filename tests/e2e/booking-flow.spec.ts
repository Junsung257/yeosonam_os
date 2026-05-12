import { test, expect } from '@playwright/test';

test.describe('Booking Flow E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to app before each test
    await page.goto('/packages');
    // Wait for page to load
    await page.waitForLoadState('networkidle');
  });

  test('should complete booking flow from package selection to confirmation', async ({
    page,
  }) => {
    // Step 1: Search and select a package
    const packageCard = page.locator('[data-testid="package-card"]').first();
    await expect(packageCard).toBeVisible();
    await packageCard.click();

    // Step 2: View package details
    await page.waitForURL('/packages/*');
    const bookButton = page.locator('[data-testid="book-package-btn"]');
    await expect(bookButton).toBeVisible();
    await bookButton.click();

    // Step 3: Fill booking form
    await page.fill('[data-testid="customer-name"]', 'John Doe');
    await page.fill('[data-testid="customer-email"]', 'john@example.com');
    await page.fill('[data-testid="customer-phone"]', '01012345678');

    // Select departure date
    await page.locator('[data-testid="departure-date"]').click();
    await page.locator('[data-testid="calendar-day-15"]').click();

    // Select number of people
    await page.locator('[data-testid="adult-count"]').fill('2');
    await page.locator('[data-testid="child-count"]').fill('1');

    // Step 4: Review booking
    const reviewButton = page.locator('[data-testid="review-booking-btn"]');
    await reviewButton.click();

    // Step 5: Verify summary
    await expect(page.locator('[data-testid="booking-summary"]')).toBeVisible();
    await expect(page.locator('[data-testid="total-price"]')).toContainText('₩');

    // Step 6: Confirm booking
    const confirmButton = page.locator('[data-testid="confirm-booking-btn"]');
    await confirmButton.click();

    // Step 7: Verify confirmation page
    await page.waitForURL('/bookings/*');
    await expect(page.locator('[data-testid="confirmation-message"]')).toContainText(
      '예약이 완료되었습니다'
    );

    // Verify booking details are displayed
    const bookingId = page.url().split('/').pop();
    await expect(page.locator('[data-testid="booking-id"]')).toContainText(bookingId || '');
  });

  test('should show error when submitting incomplete form', async ({ page }) => {
    const packageCard = page.locator('[data-testid="package-card"]').first();
    await packageCard.click();

    const bookButton = page.locator('[data-testid="book-package-btn"]');
    await bookButton.click();

    // Try to proceed without filling form
    const reviewButton = page.locator('[data-testid="review-booking-btn"]');
    await reviewButton.click();

    // Verify error message
    await expect(page.locator('[data-testid="form-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="form-error"]')).toContainText('필수 항목');
  });

  test('should validate email format', async ({ page }) => {
    const packageCard = page.locator('[data-testid="package-card"]').first();
    await packageCard.click();

    const bookButton = page.locator('[data-testid="book-package-btn"]');
    await bookButton.click();

    // Fill with invalid email
    await page.fill('[data-testid="customer-email"]', 'invalid-email');
    await page.fill('[data-testid="customer-name"]', 'John Doe');

    // Try to review
    const reviewButton = page.locator('[data-testid="review-booking-btn"]');
    await reviewButton.click();

    // Verify email validation error
    await expect(page.locator('[data-testid="email-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="email-error"]')).toContainText('유효한 이메일');
  });

  test('should update total price when changing guest count', async ({ page }) => {
    const packageCard = page.locator('[data-testid="package-card"]').first();
    await packageCard.click();

    const bookButton = page.locator('[data-testid="book-package-btn"]');
    await bookButton.click();

    // Get initial price
    const priceLocator = page.locator('[data-testid="price-per-person"]');
    const initialPrice = await priceLocator.textContent();

    // Change adult count
    const adultCount = page.locator('[data-testid="adult-count"]');
    await adultCount.fill('3');

    // Wait for price update
    await page.waitForTimeout(500);

    // Verify price changed
    const updatedPrice = await priceLocator.textContent();
    expect(updatedPrice).not.toBe(initialPrice);
    await expect(page.locator('[data-testid="total-price"]')).toContainText('₩');
  });

  test('should persist booking data when navigating back', async ({ page }) => {
    const packageCard = page.locator('[data-testid="package-card"]').first();
    await packageCard.click();

    const bookButton = page.locator('[data-testid="book-package-btn"]');
    await bookButton.click();

    // Fill partial form
    await page.fill('[data-testid="customer-name"]', 'John Doe');
    const nameInput = page.locator('[data-testid="customer-name"]');
    const enteredName = await nameInput.inputValue();

    // Navigate back to packages
    const backButton = page.locator('[data-testid="back-btn"]');
    await backButton.click();

    // Go back to booking
    await packageCard.click();
    await bookButton.click();

    // Verify form data persisted
    const persistedName = await page.locator('[data-testid="customer-name"]').inputValue();
    expect(persistedName).toBe(enteredName);
  });
});
