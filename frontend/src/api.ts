const BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8080/api"
).replace(/\/$/, "");

export type User = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
};

export type LoginResult = {
  user: User;
  accessToken: string;
};

export type Challenge = {
  challengeId: string;
  otpExpiresAt: string;
  delivery?: string;
  devOtp?: string;
};

export type Movie = {
  externalMovieId: string;
  title: string;
  poster: string | null;
  publishedYear: number | null;
  imdbRating: number | null;
};

export type MoviePage = {
  movies: Movie[];
  total: number;
  nextCursor: string | null;
  hasNextPage: boolean;
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof Error &&
    "status" in error &&
    error.status === 401;
}

export async function api<T>(
  path: string,
  token = "",
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);

  if (options.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.success) {
    throw Object.assign(
      new Error(
        payload?.error?.message ||
        payload?.message ||
        `Request failed (${response.status})`,
      ),
      { status: response.status },
    );
  }

  return payload.data as T;
}

export function post<T>(
  path: string,
  body: unknown,
  token = "",
): Promise<T> {
  return api<T>(path, token, {
    method: "POST",
    body: JSON.stringify(body),
  });
}