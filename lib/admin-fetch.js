// Wraps fetch() with the x-admin-secret header for protected API routes.
// Uses NEXT_PUBLIC_ADMIN_PASSWORD which is the shared site password
// (already in the client bundle). The server validates it against the
// server-only ADMIN_SECRET env var, so raw HTTP requests without it get 401.
const SECRET = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || '';

export function adminFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'x-admin-secret': SECRET,
    },
  });
}
