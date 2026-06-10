import { PrismaClient } from "@prisma/client";

// Next dev 의 hot-reload 로 PrismaClient 가 여러 개 생기는 것 방지
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
