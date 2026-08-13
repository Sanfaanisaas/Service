import { randomBytes } from 'node:crypto';
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function randomCode(length: number): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}
export function dateCode(date = new Date()): string { return date.toISOString().slice(2, 10).replaceAll('-', ''); }
export function claimId(sequence: number, date = new Date()): string {
  return `SF-CHG-${dateCode(date)}-${String(sequence).padStart(3, '0')}-${randomCode(4)}`;
}
export function receiptNumber(date = new Date()): string { return `SF-RCP-${dateCode(date)}-${randomCode(5)}`; }
export function secureToken(): string { return randomBytes(32).toString('base64url'); }
