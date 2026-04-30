import { type NextRequest, NextResponse } from 'next/server';

const AUTH_COOKIE_NAME = 'rag_access';

function parseCookies(cookieHeader: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) {
    return cookies;
  }

  cookieHeader.split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index === -1) {
      return;
    }

    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) {
      cookies[name] = value;
    }
  });

  return cookies;
}

function isProtectedPath(pathname: string): boolean {
  return pathname.startsWith('/api/') || pathname === '/' || pathname.startsWith('/documents');
}

function isBypassedPath(pathname: string): boolean {
  return (
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname === '/login' ||
    pathname.startsWith('/api/auth')
  );
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (isBypassedPath(pathname) || !isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  const secret = process.env.RAG_APP_PASSWORD?.trim() ?? '';
  const cookies = parseCookies(req.headers.get('cookie'));
  const hasAccess = Boolean(secret && cookies[AUTH_COOKIE_NAME] === secret);

  if (hasAccess) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const loginUrl = new URL('/login', req.url);
  loginUrl.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
