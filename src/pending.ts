import { Redis } from "@upstash/redis";
import { UserSession } from "./types";

export interface PendingSubmission extends UserSession {
  submittedAt: string;
  username?: string;
}

function r(): Redis {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

const TTL = 60 * 60 * 24 * 7; // 7 days

export async function savePending(userId: number, session: UserSession, username?: string): Promise<void> {
  await r().set(`pending:${userId}`, { ...session, submittedAt: new Date().toISOString(), username }, { ex: TTL });
}

export async function getPending(userId: number): Promise<PendingSubmission | null> {
  return r().get<PendingSubmission>(`pending:${userId}`);
}

export async function removePending(userId: number): Promise<void> {
  await r().del(`pending:${userId}`);
}

export async function isPending(userId: number): Promise<boolean> {
  return (await r().exists(`pending:${userId}`)) === 1;
}
