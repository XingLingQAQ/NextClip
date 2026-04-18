const CSRF_STORAGE_KEY = "cloudclip-csrf";

function shouldAttachCsrf(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

export function getCsrfToken(): string {
  return sessionStorage.getItem(CSRF_STORAGE_KEY) || "";
}

export function setCsrfToken(token: string): void {
  if (!token) {
    sessionStorage.removeItem(CSRF_STORAGE_KEY);
    return;
  }
  sessionStorage.setItem(CSRF_STORAGE_KEY, token);
}

export async function fetchWithCsrf(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers);
  const csrfToken = getCsrfToken();
  if (csrfToken && shouldAttachCsrf(method) && !headers.has("x-csrf-token")) {
    headers.set("x-csrf-token", csrfToken);
  }

  return fetch(input, {
    ...init,
    headers,
    credentials: init.credentials || "same-origin",
  });
}
