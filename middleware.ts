import { NextResponse } from 'next/server';

const protectedPaths = ['/client', '/admin', '/dashboard', '/config'];

export async function middleware(req: Request) {
  const url = new URL(req.url);
  const pathname = url.pathname;

  if (!protectedPaths.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const meResp = await fetch(new URL('/api/v1/auth/me', url.origin), {
    headers: { cookie: req.headers.get('cookie') || '' }
  });
  const me = await meResp.json().catch(() => ({ authenticated: false }));

  if (!me?.authenticated) {
    const redirectUrl = new URL('/login', url.origin);
    redirectUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if ((pathname.startsWith('/admin') || pathname.startsWith('/dashboard') || pathname.startsWith('/config')) && me.role !== 'admin') {
    return NextResponse.redirect(new URL('/login', url.origin));
  }

  if (pathname.startsWith('/client') && me.role !== 'tenant') {
    return NextResponse.redirect(new URL('/login', url.origin));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/client/:path*', '/admin/:path*', '/dashboard', '/config']
};
