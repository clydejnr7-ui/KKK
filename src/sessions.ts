import { Redis } from "@upstash/redis";
import { UserSession, FormStep } from "./types";

function r(): Redis {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

const TTL = 60 * 60 * 24; // 24 hours

export async function getSession(userId: number): Promise<UserSession> {
  const session = await r().get<UserSession>(`sess:${userId}`);
  return session ?? { step: "idle" };
}

export async function updateSession(userId: number, data: Partial<UserSession>): Promise<void> {
  const current = await getSession(userId);
  await r().set(`sess:${userId}`, { ...current, ...data }, { ex: TTL });
}

export async function resetSession(userId: number): Promise<void> {
  await r().set(`sess:${userId}`, { step: "idle" }, { ex: TTL });
}

export async function setStep(userId: number, step: FormStep): Promise<void> {
  await updateSession(userId, { step });
}
