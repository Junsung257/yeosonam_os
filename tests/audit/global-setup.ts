import { chromium, FullConfig } from '@playwright/test';
import * as path from 'path';

export default async function globalSetup(_config: FullConfig) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  // Hit the dev admin bypass endpoint to set ys-dev-admin cookie
  await page.goto('http://127.0.0.1:3000/api/debug/dev-admin-login?mode=on');
  await context.storageState({ path: path.join(__dirname, 'auth.json') });
  await browser.close();
}
