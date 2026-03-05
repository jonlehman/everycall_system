import { NextResponse } from 'next/server';

const protectedPaths = ['/client', '/admin', '/dashboard', '/config'];

export async function proxy(req: Request) {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const publicProtectedPaths = ['/admin/login'];
  const meResp = await fetch(new URL('/api/v1/auth/me', url.origin), {
    headers: { cookie: req.headers.get('cookie') || '' }
  });
  const me = await meResp.json().catch(() => ({ authenticated: false }));

  if (pathname === '/') {
    if (!me?.authenticated) {
      return NextResponse.redirect(new URL('/login', url.origin));
    }
    if (me.role === 'admin') {
      return NextResponse.redirect(new URL('/admin/overview', url.origin));
    }
    const clientUrl = new URL('/client/overview', url.origin);
    if (me.tenantKey) {
      clientUrl.searchParams.set('tenantKey', String(me.tenantKey));
    }
    return NextResponse.redirect(clientUrl);
  }

  if (!protectedPaths.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }
  if (publicProtectedPaths.includes(pathname)) {
    return NextResponse.next();
  }

  if (!me?.authenticated) {
    const loginPath = pathname.startsWith('/admin') ? '/admin/login' : '/login';
    const redirectUrl = new URL(loginPath, url.origin);
    redirectUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if ((pathname.startsWith('/admin') || pathname.startsWith('/dashboard') || pathname.startsWith('/config')) && me.role !== 'admin') {
    return NextResponse.redirect(new URL('/admin/login', url.origin));
  }

  if (pathname.startsWith('/client') && me.role !== 'tenant') {
    return NextResponse.redirect(new URL('/login', url.origin));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/client/:path*', '/admin/:path*', '/dashboard', '/config']
};
