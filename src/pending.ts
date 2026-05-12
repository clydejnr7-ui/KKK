import { UserSession } from "./types";

export interface PendingSubmission extends UserSession {
  submittedAt: Date;
  username?: string;
}

const pendingSubmissions = new Map<number, PendingSubmission>();

export function savePending(
  userId: number,
  session: UserSession,
  username?: string
): void {
  pendingSubmissions.set(userId, { ...session, submittedAt: new Date(), username });
}

export function getPending(userId: number): PendingSubmission | null {
  return pendingSubmissions.get(userId) ?? null;
}

export function removePending(userId: number): void {
  pendingSubmissions.delete(userId);
}

export function isPending(userId: number): boolean {
  return pendingSubmissions.has(userId);
}
