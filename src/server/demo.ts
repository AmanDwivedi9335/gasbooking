export const demoAccounts = {
  app: { email: 'admin@cylinder.test', role: 'OWNER' },
  portal: { email: 'customer@cylinder.test', role: 'CUSTOMER' },
  delivery: { email: 'driver@cylinder.test', role: 'DRIVER' },
} as const;

export type LoginWorkspace = keyof typeof demoAccounts;

export function localDemoEnabled() {
  if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEMO_SEED !== 'true') return false;
  const origin = URL.parse(process.env.APP_ORIGIN ?? '');
  return origin?.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
}
