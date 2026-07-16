const BASE = '/api';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // Only claim a JSON content-type when we're actually sending a body — Fastify
  // rejects an empty body when content-type is application/json (FST_ERR_CTP_EMPTY_JSON_BODY),
  // which would otherwise 400 every bodyless POST (complete, skip, lock, proposal apply…).
  const hasBody = init?.body != null;
  const isFormData = init?.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    // FormData bodies must NOT get an explicit content-type — fetch sets the multipart boundary itself.
    headers: { ...(hasBody && !isFormData ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error || `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export const api = {
  get: <T>(path: string) => req<T>(path),
  post: <T>(path: string, body?: unknown) => req<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) => req<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) => req<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => req<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return req<T>(path, { method: 'POST', body: form });
  },
};
