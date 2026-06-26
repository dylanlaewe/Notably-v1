// web/src/lib/authToken.js

const STORAGE_KEY = "notably.access_token";
const AUTH_CHANGE_EVENT = "notably-auth-changed";

function emitAuthChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
  }
}

export function setAccessToken(token) {
  if (token) {
    localStorage.setItem(STORAGE_KEY, token);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  emitAuthChange();
}

export function getAccessToken() {
  return localStorage.getItem(STORAGE_KEY) || null;
}

export function clearAccessToken() {
  localStorage.removeItem(STORAGE_KEY);
  emitAuthChange();
}

export function isLoggedIn() {
  return !!getAccessToken();
}

export function subscribeToAuthChanges(callback) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const notify = (event) => {
    if (!event || !("key" in event) || event.key === STORAGE_KEY) {
      callback();
    }
  };

  window.addEventListener(AUTH_CHANGE_EVENT, notify);
  window.addEventListener("storage", notify);

  return () => {
    window.removeEventListener(AUTH_CHANGE_EVENT, notify);
    window.removeEventListener("storage", notify);
  };
}
