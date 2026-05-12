import { test, expect } from '@playwright/test';

test.describe('Database Migration Validation E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/database');
    await page.waitForLoadState('networkidle');
  });

  test('should list all applied migrations with timestamps', async ({ page }) => {
    // Navigate to migrations panel
    const migrationsPanel = page.locator('[data-testid="migrations-panel"]');
    await expect(migrationsPanel).toBeVisible();

    // Verify migrations table exists
    const migrationsTable = page.locator('[data-testid="migrations-table"]');
    await expect(migrationsTable).toBeVisible();

    // Verify columns are present
    await expect(page.locator('[data-testid="migration-header-name"]')).toBeVisible();
    await expect(page.locator('[data-testid="migration-header-timestamp"]')).toBeVisible();
    await expect(page.locator('[data-testid="migration-header-status"]')).toBeVisible();

    // Verify at least one migration listed
    const migrationRows = page.locator('[data-testid="migration-row"]');
    const count = await migrationRows.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Verify each row has expected fields
    const firstRow = migrationRows.first();
    await expect(firstRow.locator('[data-testid="migration-name"]')).toBeVisible();
    await expect(firstRow.locator('[data-testid="migration-timestamp"]')).toBeVisible();
    await expect(firstRow.locator('[data-testid="migration-status"]')).toContainText('applied');
  });

  test('should detect pending migrations', async ({ page }) => {
    // Check if pending migrations exist
    const pendingSection = page.locator('[data-testid="pending-migrations-section"]');

    if (await pendingSection.isVisible()) {
      // Verify pending migrations are listed
      const pendingMigrations = page.locator('[data-testid="pending-migration-row"]');
      const count = await pendingMigrations.count();
      expect(count).toBeGreaterThanOrEqual(1);

      // Verify apply button is available
      const applyBtn = page.locator('[data-testid="apply-pending-migrations-btn"]');
      await expect(applyBtn).toBeVisible();
      await expect(applyBtn).toBeEnabled();
    } else {
      // No pending migrations is also valid
      const noPendingMsg = page.locator('[data-testid="no-pending-migrations-msg"]');
      await expect(noPendingMsg).toBeVisible();
    }
  });

  test('should validate schema consistency after migration', async ({ page }) => {
    // Navigate to schema validation
    const validateBtn = page.locator('[data-testid="validate-schema-btn"]');
    await validateBtn.click();

    // Wait for validation to complete
    await page.waitForSelector('[data-testid="validation-complete"]', { timeout: 30000 });

    // Verify validation results
    const validationResults = page.locator('[data-testid="validation-results"]');
    await expect(validationResults).toBeVisible();

    // Check for errors
    const errorCount = page.locator('[data-testid="validation-errors-count"]');
    const errorText = await errorCount.textContent();
    const errors = parseInt(errorText?.replace(/[^0-9]/g, '') || '0');

    if (errors > 0) {
      // If there are errors, they should be displayed
      const errorList = page.locator('[data-testid="validation-error-item"]');
      expect(await errorList.count()).toEqual(errors);
    } else {
      // No errors is ideal
      const successMsg = page.locator('[data-testid="schema-valid-msg"]');
      await expect(successMsg).toBeVisible();
    }
  });

  test('should check for missing RLS policies', async ({ page }) => {
    // Navigate to RLS policy validation
    const rlsTab = page.locator('[data-testid="rls-policies-tab"]');
    await rlsTab.click();

    // Wait for RLS check to load
    await page.waitForLoadState('networkidle');

    // Verify RLS status
    const rlsStatus = page.locator('[data-testid="rls-policy-status"]');
    await expect(rlsStatus).toBeVisible();

    // Check for tables without policies
    const tablesWithoutPolicies = page.locator('[data-testid="table-missing-policies"]');

    if (await tablesWithoutPolicies.isVisible()) {
      // Get list of tables missing policies
      const missingPolicyList = page.locator('[data-testid="missing-policy-item"]');
      const count = await missingPolicyList.count();

      // Each should show table name and required policy type
      for (let i = 0; i < Math.min(count, 3); i++) {
        const item = missingPolicyList.nth(i);
        await expect(item.locator('[data-testid="table-name"]')).toBeVisible();
        await expect(item.locator('[data-testid="policy-type"]')).toBeVisible();
      }
    } else {
      // All RLS policies in place
      const allPoliciesMsg = page.locator('[data-testid="all-rls-policies-present-msg"]');
      await expect(allPoliciesMsg).toBeVisible();
    }
  });

  test('should detect and report schema drift', async ({ page }) => {
    // Navigate to schema drift detection
    const driftTab = page.locator('[data-testid="schema-drift-tab"]');
    await driftTab.click();

    // Trigger drift detection
    const detectDriftBtn = page.locator('[data-testid="detect-drift-btn"]');
    await detectDriftBtn.click();

    // Wait for detection
    await page.waitForSelector('[data-testid="drift-detection-complete"]', { timeout: 60000 });

    // Verify drift report
    const driftReport = page.locator('[data-testid="drift-report"]');
    await expect(driftReport).toBeVisible();

    // Check for drift items
    const driftItems = page.locator('[data-testid="drift-item"]');
    const count = await driftItems.count();

    if (count > 0) {
      // Display drift details
      for (let i = 0; i < Math.min(count, 5); i++) {
        const item = driftItems.nth(i);
        await expect(item.locator('[data-testid="drift-table"]')).toBeVisible();
        await expect(item.locator('[data-testid="drift-type"]')).toBeVisible();
        await expect(item.locator('[data-testid="drift-description"]')).toBeVisible();
      }
    } else {
      // No drift detected is ideal
      const noDriftMsg = page.locator('[data-testid="no-drift-detected-msg"]');
      await expect(noDriftMsg).toBeVisible();
    }
  });

  test('should validate foreign key relationships', async ({ page }) => {
    // Navigate to foreign key validation
    const fkTab = page.locator('[data-testid="foreign-keys-tab"]');
    await fkTab.click();

    // Trigger validation
    const validateFkBtn = page.locator('[data-testid="validate-foreign-keys-btn"]');
    await validateFkBtn.click();

    // Wait for validation
    await page.waitForSelector('[data-testid="fk-validation-complete"]', { timeout: 30000 });

    // Check for orphaned records
    const orphanedCheck = page.locator('[data-testid="orphaned-records-section"]');

    if (await orphanedCheck.isVisible()) {
      const orphanedItems = page.locator('[data-testid="orphaned-record-item"]');
      const orphanCount = await orphanedItems.count();

      if (orphanCount > 0) {
        // Display orphaned records with details
        const item = orphanedItems.first();
        await expect(item.locator('[data-testid="table-name"]')).toBeVisible();
        await expect(item.locator('[data-testid="row-count"]')).toBeVisible();
      }
    } else {
      // No orphaned records
      const validMsg = page.locator('[data-testid="all-foreign-keys-valid-msg"]');
      await expect(validMsg).toBeVisible();
    }
  });

  test('should monitor index health and detect unused indexes', async ({ page }) => {
    // Navigate to index health
    const indexTab = page.locator('[data-testid="indexes-tab"]');
    await indexTab.click();

    // Wait for index analysis
    await page.waitForLoadState('networkidle');

    // Verify index list
    const indexList = page.locator('[data-testid="index-item"]');
    const count = await indexList.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Check for unused indexes
    const unusedSection = page.locator('[data-testid="unused-indexes-section"]');

    if (await unusedSection.isVisible()) {
      const unusedIndexes = page.locator('[data-testid="unused-index-item"]');
      const unusedCount = await unusedIndexes.count();

      if (unusedCount > 0) {
        // Show first unused index with recommendation
        const item = unusedIndexes.first();
        await expect(item.locator('[data-testid="index-name"]')).toBeVisible();
        await expect(item.locator('[data-testid="drop-recommendation"]')).toBeVisible();
      }
    }

    // Check for missing indexes on foreign keys
    const fkIndexSection = page.locator('[data-testid="missing-fk-indexes-section"]');

    if (await fkIndexSection.isVisible()) {
      const missingFkIndexes = page.locator('[data-testid="missing-fk-index-item"]');
      const count = await missingFkIndexes.count();

      if (count > 0) {
        const item = missingFkIndexes.first();
        await expect(item.locator('[data-testid="table-column"]')).toBeVisible();
      }
    }
  });

  test('should validate table statistics and row counts', async ({ page }) => {
    // Navigate to table statistics
    const statsTab = page.locator('[data-testid="table-stats-tab"]');
    await statsTab.click();

    // Load statistics
    const loadStatsBtn = page.locator('[data-testid="load-table-stats-btn"]');
    if (await loadStatsBtn.isVisible()) {
      await loadStatsBtn.click();
      await page.waitForSelector('[data-testid="stats-loaded"]', { timeout: 30000 });
    }

    // Verify table rows
    const tableStats = page.locator('[data-testid="table-stat-row"]');
    const count = await tableStats.count();
    expect(count).toBeGreaterThanOrEqual(5);

    // Check each major table
    const expectedTables = [
      'products',
      'bookings',
      'customers',
      'land_operators',
      'message_logs',
    ];

    for (const tableName of expectedTables) {
      const row = page.locator(`[data-testid="table-stat-${tableName}"]`);

      if (await row.isVisible()) {
        await expect(row.locator('[data-testid="row-count"]')).toBeVisible();
        await expect(row.locator('[data-testid="disk-size"]')).toBeVisible();
      }
    }
  });

  test('should track migration execution time and performance', async ({ page }) => {
    // Navigate to migration history
    const historyTab = page.locator('[data-testid="migration-history-tab"]');
    await historyTab.click();

    // Verify migration performance metrics
    const performanceData = page.locator('[data-testid="migration-performance"]');
    await expect(performanceData).toBeVisible();

    // Check execution times
    const migrationTimes = page.locator('[data-testid="migration-execution-time"]');
    const count = await migrationTimes.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Verify each migration shows execution time
    for (let i = 0; i < Math.min(count, 5); i++) {
      const time = migrationTimes.nth(i);
      const timeText = await time.textContent();
      expect(timeText).toMatch(/\d+(\.\d+)?\s*(ms|s)/);
    }

    // Check for slow migrations (>5 seconds)
    const slowMigrations = page.locator('[data-testid="slow-migration-warning"]');

    if (await slowMigrations.isVisible()) {
      const warnings = await slowMigrations.count();
      if (warnings > 0) {
        const item = slowMigrations.first();
        await expect(item.locator('[data-testid="migration-name"]')).toBeVisible();
      }
    }
  });
});
