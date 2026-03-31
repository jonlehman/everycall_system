import { NextResponse } from 'next/server';

const protectedPaths = ['/client', '/admin', '/dashboard', '/config'];
const clientBillingPath = '/client/account/billing';

async function getBillingState(url: URL, cookieHeader: string) {
  const resp = await fetch(new URL('/api/v1/billing', url.origin), {
    headers: { cookie: cookieHeader }
  });
  if (!resp.ok) {
    return null;
  }
  return resp.json().catch(() => null);
}

export async function proxy(req: Request) {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const publicProtectedPaths = ['/admin/login'];
  const cookieHeader = req.headers.get('cookie') || '';
  const meResp = await fetch(new URL('/api/v1/auth/me', url.origin), {
    headers: { cookie: cookieHeader }
  });
  const me = await meResp.json().catch(() => ({ authenticated: false }));

  if (pathname === '/') {
    if (!me?.authenticated) {
      return NextResponse.redirect(new URL('/login', url.origin));
    }
    if (me.role === 'admin') {
      return NextResponse.redirect(new URL('/admin/overview', url.origin));
    }
    const clientUrl = new URL('/client/dashboard', url.origin);
    if (me.role === 'tenant') {
      const billing = await getBillingState(url, cookieHeader);
      const locked = billing?.billing?.appAccessStatus === 'billing_locked' || billing?.billing?.status === 'deactivated';
      if (locked) {
        clientUrl.pathname = clientBillingPath;
      }
    }
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

  if (pathname.startsWith('/client') && me.role === 'tenant') {
    const billing = await getBillingState(url, cookieHeader);
    const locked = billing?.billing?.appAccessStatus === 'billing_locked' || billing?.billing?.status === 'deactivated';
    if (locked && pathname !== clientBillingPath) {
      const redirectUrl = new URL(clientBillingPath, url.origin);
      if (me.tenantKey) {
        redirectUrl.searchParams.set('tenantKey', String(me.tenantKey));
      }
      return NextResponse.redirect(redirectUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/client/:path*', '/admin/:path*', '/dashboard', '/config']
};
