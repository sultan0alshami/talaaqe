// Route guard (Next 16: proxy.ts replaces middleware.ts).
// Protects the three dashboards; role mismatches bounce to the right home.
import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/jwt";

const ROLE_HOME: Record<string, string> = {
  CLIENT: "/client",
  PROVIDER: "/provider",
  ADMIN: "/admin",
};

const PREFIX_ROLE: [string, string][] = [
  ["/client", "CLIENT"],
  ["/provider", "PROVIDER"],
  ["/admin", "ADMIN"],
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const guard = PREFIX_ROLE.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + "/"));
  if (!guard) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  if (session.role !== guard[1]) {
    return NextResponse.redirect(new URL(ROLE_HOME[session.role] ?? "/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/client/:path*", "/provider/:path*", "/admin/:path*"],
};
