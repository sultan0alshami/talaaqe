// Optimistic navigation guard alongside src/app per installed Next convention.
// Protects the three dashboards; role mismatches bounce to the right home.
import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/jwt";

const ROLE_HOME: Record<string, string> = {
  BRAND: "/brand",
  CREATOR: "/creator",
  ADMIN: "/admin",
};

const PREFIX_ROLE: [string, string][] = [
  ["/brand", "BRAND"],
  ["/creator", "CREATOR"],
  ["/admin", "ADMIN"],
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const legacyRole = pathname === "/client" || pathname.startsWith("/client/") ? "BRAND"
    : pathname === "/provider" || pathname.startsWith("/provider/") ? "CREATOR" : null;
  if (legacyRole) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const session = token ? await verifySessionToken(token) : null;
    return NextResponse.redirect(new URL(session ? ROLE_HOME[session.role] : "/login", request.url));
  }
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
  matcher: ["/client/:path*", "/provider/:path*", "/creator/:path*", "/brand/:path*", "/admin/:path*"],
};
