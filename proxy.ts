import { NextResponse } from 'next/server';

const protectedPaths = ['/client', '/admin', '/dashboard', '/config'];
const salesPath = (pathname: string) => pathname === '/sales' || pathname.startsWith('/sales/');
const clientBillingPath = '/client/account/billing';
const billingAllowedClientPaths = new Set([
  clientBillingPath,
  '/client/account/support'
]);

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
  const getSalesState = async () => {
    const response = await fetch(new URL('/api/v1/sales/auth/me', url.origin), {
      headers: { cookie: cookieHeader }
    });
    return response.ok ? response.json().catch(() => ({ authenticated: false })) : { authenticated: false };
  };

  if (pathname === '/') {
    if (!me?.authenticated) {
      const sales = await getSalesState();
      if (sales?.authenticated) return NextResponse.redirect(new URL('/sales', url.origin));
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

  if (pathname === '/admin/sales') {
    return NextResponse.redirect(new URL('/sales', url.origin));
  }

  if (salesPath(pathname)) {
    if (pathname === '/sales/login') return NextResponse.next();
    if (me?.authenticated && me.role === 'admin') return NextResponse.next();
    const sales = await getSalesState();
    if (sales?.authenticated) return NextResponse.next();
    const redirectUrl = new URL('/sales/login', url.origin);
    redirectUrl.searchParams.set('next', `${pathname}${url.search}`);
    return NextResponse.redirect(redirectUrl);
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
    redirectUrl.searchParams.set('next', `${pathname}${url.search}`);
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
    if (locked && !billingAllowedClientPaths.has(pathname)) {
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
  matcher: ['/', '/client/:path*', '/admin/:path*', '/sales/:path*', '/dashboard', '/config']
};
