import { test, expect } from '@playwright/test';

test.describe('Navigation Guards', () => {
  test('should redirect facility-scoped pages to sign-in', async ({ page }) => {
    // Facility detail layout uses createServerCaller() which enforces auth
    await page.goto('/facilities/test-id/inventory');

    await expect(page).toHaveURL(/\/auth\/signin/);
  });

  test('should render facilities list page shell', async ({ page }) => {
    // /facilities is a client component — it renders without server-side auth redirect
    // The tRPC query will fail but the page shell (h1, buttons) still renders
    await page.goto('/facilities');

    await expect(page.locator('h1')).toContainText('Facilities');
  });
});
