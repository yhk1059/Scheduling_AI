import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // 값이 없어도 항상 치환해 e2e 전용 로그인 코드가 프로덕션 번들에서 빠지게 한다(lib/supabase.ts, ADR-020)
  env: { NEXT_PUBLIC_E2E_LOGIN: process.env.NEXT_PUBLIC_E2E_LOGIN ?? "" },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // /api/py/* → FastAPI. 개발 중에는 로컬 uvicorn, 배포에서는 Vercel Python 함수(api/index.py).
  async rewrites() {
    return [
      {
        source: "/api/py/:path*",
        destination:
          process.env.NODE_ENV === "development"
            ? "http://127.0.0.1:8000/api/py/:path*"
            : "/api/",
      },
    ];
  },
};

export default nextConfig;
