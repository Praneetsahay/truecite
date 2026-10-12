import { NextResponse, type NextRequest } from "next/server";

/*
  An optimistic check only: signed-out visitors to the app or the admin panel
  go to the login page. The real check happens in the data access layer
  (src/lib/auth/dal.ts) on every page and action.
*/
export function proxy(request: NextRequest) {
  if (!request.cookies.has("tc_session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*"],
};
