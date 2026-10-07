import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test('should display the sign-in page', async ({ page }) => {
    await page.goto('/auth/signin');

    await expect(page.locator('h2')).toContainText('Formul8 Metrc Platform');
    await expect(
      page.locator('button', { hasText: 'Google' })
    ).toBeVisible();
  });

  test('should redirect root to sign-in when unauthenticated', async ({ page }) => {
    await page.goto('/');

    // Root page checks session server-side and redirects unauthenticated users
    await expect(page).toHaveURL(/\/auth\/signin/);
  });

  test('should redirect dashboard to sign-in when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard');

    // Dashboard uses createServerCaller() which redirects if no session
    await expect(page).toHaveURL(/\/auth\/signin/);
  });
});
