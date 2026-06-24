// Helper for calling Cloudflare Workers at /api/*
// In dev, Vite proxy routes these to localhost:8788

import { getAuthHeader } from '@/lib/realtime';

export async function api(path, options = {}) {
  const { method = 'POST', body, headers: customHeaders } = options;

  // Attach the current user's Bearer token so authenticated workers
  // (send-message, etc.) accept the request.
  const authHeader = await getAuthHeader();

  const headers = {
    'Content-Type': 'application/json',
    ...authHeader,
    ...customHeaders,
  };

  const res = await fetch(`/api/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `API error: ${res.status}`);
  }

  return data;
}

// Convenience methods
export const sendMessage = (payload) => api('send-message', { body: payload });
