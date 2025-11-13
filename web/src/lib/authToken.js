// web/src/lib/authToken.js

const STORAGE_KEY = "notably.access_token";

export function setAccessToken(token) {
  if (token) {
    localStorage.setItem(STORAGE_KEY, token);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function getAccessToken() {
  return localStorage.getItem(STORAGE_KEY) || null;
}

export function clearAccessToken() {
  localStorage.removeItem(STORAGE_KEY);
}

export function isLoggedIn() {
  return !!getAccessToken();
}
