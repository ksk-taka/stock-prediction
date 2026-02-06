import { NextRequest, NextResponse } from "next/server";

/**
 * Basic認証 middleware
 * 環境変数 BASIC_AUTH_USER / BASIC_AUTH_PASSWORD が設定されている場合のみ有効
 * ローカル開発時は認証なしでアクセス可能
 */
export function middleware(request: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;

  // 認証設定がなければスキップ（ローカル開発用）
  if (!user || !pass) {
    return NextResponse.next();
  }

  const authHeader = request.headers.get("authorization");

  if (authHeader) {
    const [scheme, encoded] = authHeader.split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = atob(encoded);
      const [u, p] = decoded.split(":");
      if (u === user && p === pass) {
        return NextResponse.next();
      }
    }
  }

  return new NextResponse("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Stock Prediction"',
    },
  });
}

export const config = {
  // 静的アセット(_next/static, favicon等)は除外
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
