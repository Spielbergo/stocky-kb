import { NextResponse } from 'next/server';

// Routes that require the admin secret header
const PROTECTED_PREFIXES = [
  '/api/ads-apply',
  '/api/ads-rollback',
  '/api/ads-optimize',
  '/api/ads-audit',
  '/api/ads-negative-keyword',
  '/api/qs-snapshot',
];

export function middleware(request) {
  const { pathname } = request.nextUrl;

  if (!PROTECTED_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const secret = process.env.ADMIN_SECRET;

  // If ADMIN_SECRET is not configured, pass through (allows dev without it set)
  if (!secret) return NextResponse.next();

  const provided = request.headers.get('x-admin-secret');
  if (provided !== secret) {
    return new NextResponse(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/api/ads-apply',
    '/api/ads-rollback',
    '/api/ads-optimize',
    '/api/ads-audit',
    '/api/ads-negative-keyword',
    '/api/qs-snapshot',
  ],
};
