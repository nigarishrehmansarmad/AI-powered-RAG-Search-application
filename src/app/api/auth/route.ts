import { NextResponse } from 'next/server';
import { getAuthCookieName, getRequiredEnv, checkRateLimit } from '@/lib/security';

function buildCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export async function GET(req: Request) {
  const cookieName = getAuthCookieName();
  const secret = process.env.RAG_APP_PASSWORD?.trim() ?? '';
  const cookies = req.headers.get('cookie') ?? '';
  const isAuthenticated = Boolean(secret && cookies.split(';').some((part) => part.trim() === `${cookieName}=${secret}`));

  return NextResponse.json({ authenticated: isAuthenticated });
}

export async function POST(req: Request) {
  try {
    const rateLimit = checkRateLimit(req, 'auth', 10, 15 * 60 * 1000);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        { status: 429, headers: rateLimit.retryAfterSeconds ? { 'Retry-After': String(rateLimit.retryAfterSeconds) } : undefined },
      );
    }

    const secret = getRequiredEnv('RAG_APP_PASSWORD');
    const body = await req.json().catch(() => null);
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!password) {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 });
    }

    if (password !== secret) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set(getAuthCookieName(), secret, buildCookieOptions(60 * 60 * 12));
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(getAuthCookieName(), '', { path: '/', maxAge: 0 });
  return response;
}
