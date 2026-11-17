export async function api<T>(path: string, body?: object, key?: string): Promise<T> {
  const response = await fetch('/api/v1/' + path, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    body: JSON.stringify(body),
  } : { cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? 'The request could not be completed.');
  return payload.data as T;
}

export const rupees = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR',
  maximumFractionDigits: value % 100 ? 2 : 0, minimumFractionDigits: value % 100 ? 2 : 0 }).format(value / 100);
export const integer = (value: number) => new Intl.NumberFormat('en-IN').format(value);
export const human = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
export const dateLabel = (value: string) => value ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short',
  timeZone: 'Asia/Kolkata' }).format(new Date(value)) : '—';
export const today = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

