import { test, expect } from '@playwright/test';

// Needs a seeded user: E2E_EMAIL / E2E_PASSWORD (e.g. the demo login after `demo-reset`).
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe('Sign-in layout', () => {
  test.skip(!email || !password, 'set E2E_EMAIL and E2E_PASSWORD to a seeded user');

  test('shows the sidebar right after password sign-in, without a reload', async ({ page }) => {
    await page.goto('/auth/signin');
    await page.fill('input[name=email]', email!);
    await page.fill('input[name=password]', password!);
    await page.click('button[type=submit]');

    await expect(page).toHaveURL(/\/executive/);
    // The root layout renders the sidebar server-side from the session, so it only
    // appears if the post-sign-in navigation re-renders the layout.
    await expect(page.locator('nav').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Facilities' })).toBeVisible();
  });
});
