import { UserSession, FormStep } from "./types";

// In-memory session store (works for Vercel serverless with warm instances)
// For production scale, replace with Redis/Upstash
const sessions = new Map<number, UserSession>();

export function getSession(userId: number): UserSession {
  if (!sessions.has(userId)) {
    sessions.set(userId, { step: "idle" });
  }
  return sessions.get(userId)!;
}

export function updateSession(userId: number, data: Partial<UserSession>): void {
  const current = getSession(userId);
  sessions.set(userId, { ...current, ...data });
}

export function resetSession(userId: number): void {
  sessions.set(userId, { step: "idle" });
}

export function setStep(userId: number, step: FormStep): void {
  updateSession(userId, { step });
}
