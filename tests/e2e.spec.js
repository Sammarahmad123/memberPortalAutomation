const { test, expect } = require('./fixtures');
const { test: baseTest } = require('@playwright/test');

// 1. Invalid login shows inline error and stays on the login page
baseTest('invalid login shows error and does not redirect', async ({ page }) => {
  await page.goto('');
  await page.getByTestId('email-input').fill('wrong@example.com');
  await page.getByTestId('password-input').fill('wrongpassword');
  await page.getByTestId('login-btn').click();
  await expect(page.getByTestId('login-error')).toBeVisible();
  await expect(page.getByTestId('login-error')).toHaveText('Incorrect credentials. Please try again.');
  await expect(page).not.toHaveURL(/dashboard\.html/);
});

// 2. Valid login lands on the dashboard with member name and balance
test('valid login reaches dashboard with correct member info', async ({ loggedInPage }) => {
  await expect(loggedInPage).toHaveURL(/dashboard\.html/);
  await expect(loggedInPage.locator('h1')).toHaveText('Welcome, Sarah Chen');
  await expect(loggedInPage.locator('#current-balance')).toHaveText('$142,580.33');
});

// 3. Contribution form accepts an amount and confirms submission with details
test('contribution form submits and shows success message', async ({ loggedInPage }) => {
  await loggedInPage.goto('contribute.html');
  await loggedInPage.getByTestId('contribution-amount').fill('500');
  // Leave contribution type (Concessional) and payment method (Bank Transfer) at defaults
  await loggedInPage.getByTestId('submit-btn').click();
  await expect(loggedInPage.locator('#contribution-success')).toBeVisible();
  await expect(loggedInPage.getByTestId('success-headline')).toHaveText('Contribution submitted successfully.');
  await expect(loggedInPage.getByTestId('success-amount')).toHaveText('$500.00');
  await expect(loggedInPage.getByTestId('success-type')).toHaveText('Concessional');
  await expect(loggedInPage.getByTestId('success-method')).toHaveText('Bank Transfer');
});

// 4. Transaction history table loads with data and valid statuses
test('transaction history table shows rows with valid statuses', async ({ loggedInPage }) => {
  await loggedInPage.goto('transactions.html');
  await expect(loggedInPage.getByTestId('transactions-table')).toBeVisible();
  const rows = loggedInPage.getByTestId('transactions-table').locator('tbody tr');
  expect(await rows.count()).toBeGreaterThanOrEqual(6);
  const valid = new Set(['Pending', 'Completed', 'Failed']);
  for (const text of await loggedInPage.getByTestId('transaction-status').allTextContents()) {
    expect(valid.has(text.trim())).toBe(true);
  }
});

// 5. Member details form shows pre-filled data and confirms save
test('member details shows correct data and saves successfully', async ({ loggedInPage }) => {
  await loggedInPage.goto('member-details.html');
  await expect(loggedInPage.getByTestId('member-name-input')).toHaveValue('Sarah Chen');
  await expect(loggedInPage.getByTestId('member-email-input')).toHaveValue('sarah.chen@restsuper.com.au');
  await loggedInPage.getByTestId('save-btn').click();
  await expect(loggedInPage.locator('#member-details-success')).toBeVisible();
});
