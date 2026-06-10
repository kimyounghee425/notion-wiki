import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 모노레포의 @repo/core 를 TS 소스 그대로 트랜스파일 (별도 빌드 단계 없음)
  transpilePackages: ["@repo/core"],
};

export default nextConfig;
