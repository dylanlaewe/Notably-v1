// web/src/lib/apiClient.js
import { getAccessToken, clearAccessToken } from "./authToken";

const DEFAULT_BASE_URL = "http://127.0.0.1:8000";

/**
 * Returns the base API URL for the backend.
 * You can override via VITE_API_BASE_URL in web/.env.local if you want.
 */
export function getApiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL || DEFAULT_BASE_URL;
}

/**
 * Wrapper around fetch that:
 *  - prefixes the URL with the API base URL
 *  - attaches Authorization: Bearer <token> if present
 *  - optionally JSON-encodes the body
 */
export async function apiFetch(path, options = {}) {
  const baseUrl = getApiBaseUrl();
  const url = path.startsWith("http") ? path : `${baseUrl}${path}`;

  const token = getAccessToken();
  const headers = new Headers(options.headers || {});

  if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    // Token likely expired or invalid; clear it so the app can force a re-login.
    clearAccessToken();
  }

  return response;
}
