import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public details?: unknown) { super(message); }
}
type Envelope<T> = { success: true; data: T } | { success: false; error: { code: string; message: string; details?: unknown } };
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  const response = await fetch(`${import.meta.env.VITE_API_URL || '/api'}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json() as Envelope<T>;
  if (!response.ok || !payload.success) {
    const error = 'error' in payload ? payload.error : { code: 'HTTP_ERROR', message: 'Request failed.' };
    throw new ApiError(error.code, error.message, response.status, error.details);
  }
  return payload.data;
}
export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
