const { test: base, expect } = require('@playwright/test');

const test = base.extend({
  loggedInPage: async ({ page }, use) => {
    await page.goto('');
    await page.getByTestId('email-input').fill('sarah.chen@restsuper.com.au');
    await page.getByTestId('password-input').fill('Demo2026!');
    await page.getByTestId('login-btn').click();
    await page.waitForURL(/dashboard\.html/);
    await use(page);
  },
});

module.exports = { test, expect };
