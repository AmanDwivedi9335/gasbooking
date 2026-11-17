import { expect, test, type Page } from '@playwright/test';
import { totp } from '../src/server/auth';

async function login(page: Page, path: string, email: string) {
  await page.goto(path);
  await page.getByLabel('User ID or email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('browser-password-2026');
  if (email === 'admin@cylinder.test') {
    await page.getByRole('button', { name: 'Agency ID and authenticator options' }).click();
    await page.getByLabel('Authenticator code').fill(totp(Buffer.from('playwright-auth-test'), Math.floor(Date.now() / 30_000)));
  }
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function command(page: Page, action: string, fields?: () => Promise<void>) {
  await page.getByRole('button', { name: action, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await fields?.();
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test('customer booking moves through staff allocation and driver collection', async ({ page, browser, baseURL }, info) => {
  await login(page, '/login', 'admin@cylinder.test');
  await expect(page.getByRole('heading', { name: 'Operations dashboard' })).toBeVisible();
  await expect(page.getByText('Booking pipeline')).toBeVisible();
  await expect(page.getByRole('table').getByRole('link').first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('dashboard.png'), fullPage: true });

  await page.getByRole('link', { name: 'Customers', exact: true }).click();
  await page.getByRole('button', { name: 'Add customer' }).click();
  await page.getByLabel('Full name').fill('Playwright Customer');
  await page.getByLabel('Mobile number').fill('+919991230012');
  await page.getByLabel('Street address').fill('25 Sample Road');
  await page.getByLabel('City').fill('Pune');
  await page.getByLabel('PIN code').fill('411001');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Playwright Customer', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Branches', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Require a customer portal code at delivery').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Required', exact: true })).toBeVisible();

  const customerContext = await browser.newContext({ baseURL });
  const customer = await customerContext.newPage();
  await login(customer, '/portal/login', 'customer@cylinder.test');
  await customer.getByRole('link', { name: 'Book a refill' }).first().click();
  await customer.getByLabel('Connection', { exact: true }).selectOption({ label: 'CON-1001' });
  await customer.getByLabel('Cylinder product').selectOption({ label: 'Domestic LPG · 14.2 kg' });
  await customer.getByRole('button', { name: 'Create booking' }).click();
  await expect(customer.getByRole('heading', { name: /^BK-/ })).toBeVisible();
  const bookingId = customer.url().split('/').at(-1);

  await page.goto('/app/bookings/' + bookingId);
  await command(page, 'Confirm booking');
  await command(page, 'Allocate stock', async () => { await page.getByLabel('Warehouse', { exact: true }).selectOption({ label: 'Central warehouse' }); });
  await command(page, 'Assign driver', async () => { await page.getByLabel('Delivery agent', { exact: true }).selectOption({ label: 'Arjun Patil' }); });
  await command(page, 'Dispatch');
  await customer.reload();
  const code = customer.getByText(/^Delivery code \d{6}$/);
  await expect(code).toBeVisible();
  const otp = (await code.textContent())!.slice(-6);

  const driverContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1, hasTouch: true });
  const driver = await driverContext.newPage();
  await login(driver, '/delivery/login', 'driver@cylinder.test');
  await driver.goto('/delivery/' + bookingId);
  await command(driver, 'Record delivery', async () => {
    await driver.getByLabel('Recipient', { exact: true }).fill('Aditi Kulkarni');
    await driver.getByLabel('Empty cylinders collected').fill('1');
    await driver.getByLabel('Delivery code', { exact: true }).fill(otp);
  });
  await expect(driver.getByRole('heading', { name: /^Invoice INV-/ })).toBeVisible();
  await command(driver, 'Record payment');
  await expect(driver.getByText('Paid', { exact: true })).toBeVisible();

  await customer.reload();
  await expect(customer.getByText('Delivered', { exact: true }).first()).toBeVisible();
  await expect(customer.getByText('Paid', { exact: true })).toBeVisible();
  await page.goto('/app/inventory/movements');
  await expect(page.getByRole('cell', { name: 'COMPLETE', exact: true }).first()).toBeVisible();
  await page.goto('/app/communications/whatsapp');
  await expect(page.getByRole('cell', { name: 'PAYMENT_RECEIVED', exact: true }).first()).toBeVisible();
  await customerContext.close();
  await driverContext.close();
});
