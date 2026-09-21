export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    public status: number,
    public override message: string,
    public data?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Single shared in-flight refresh promise.
 * Ensures simultaneous 401 errors await the EXACT SAME /refresh request,
 * preventing multiple concurrent token rotations that would trigger
 * backend refresh-token reuse detection and session mass-revocation.
 */
let sharedRefreshPromise: Promise<boolean> | null = null;

async function executeTokenRefresh(): Promise<boolean> {
  if (sharedRefreshPromise) {
    return sharedRefreshPromise;
  }

  sharedRefreshPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        return true;
      }

      return false;
    } catch {
      return false;
    } finally {
      sharedRefreshPromise = null;
    }
  })();

  return sharedRefreshPromise;
}

export interface RequestOptions extends RequestInit {
  _isRetry?: boolean;
}

/**
 * Type-safe API client that:
 * 1. Enforces `credentials: "include"` on all cross-origin requests for httpOnly cookies.
 * 2. Deduplicates 401 token refreshes via a single shared in-flight promise.
 * 3. Retries failed calls exactly once upon successful token rotation.
 */
export async function apiRequest<T = unknown>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const url = endpoint.startsWith("http")
    ? endpoint
    : `${API_BASE_URL}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers,
  });

  // Handle 401 Unauthorized with token refresh and single retry
  const isAuthEndpoint =
    endpoint.includes("/api/v1/auth/login") ||
    endpoint.includes("/api/v1/auth/signup") ||
    endpoint.includes("/api/v1/auth/refresh") ||
    endpoint.includes("/api/v1/auth/logout");

  if (response.status === 401 && !options._isRetry && !isAuthEndpoint) {
    const refreshSuccess = await executeTokenRefresh();

    if (refreshSuccess) {
      // Retry original request exactly once
      return apiRequest<T>(endpoint, {
        ...options,
        _isRetry: true,
      });
    }

    // Refresh failed or revoked — dispatch event for AuthProvider to clear state
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("nextcrm:session-expired"));
    }
  }

  // Parse response
  let data: unknown = null;
  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const errorMessage =
      (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string")
        ? (data as { error: string }).error
        : (data && typeof data === "object" && "message" in data && typeof (data as { message: unknown }).message === "string")
        ? (data as { message: string }).message
        : `Request failed with status ${response.status}`;

    throw new ApiError(response.status, errorMessage, data);
  }

  return data as T;
}

export const api = {
  get: <T = unknown>(endpoint: string, options?: RequestOptions) =>
    apiRequest<T>(endpoint, { ...options, method: "GET" }),

  post: <T = unknown>(endpoint: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(endpoint, {
      ...options,
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),

  patch: <T = unknown>(endpoint: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(endpoint, {
      ...options,
      method: "PATCH",
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),

  delete: <T = unknown>(endpoint: string, options?: RequestOptions) =>
    apiRequest<T>(endpoint, { ...options, method: "DELETE" }),
};
