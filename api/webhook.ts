import { VercelRequest, VercelResponse } from "@vercel/node";
import { webhookCallback } from "grammy";
import { bot } from "../src/index";

const handler = webhookCallback(bot, "http");

export default async function webhook(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(200).json({ status: "Trading Flux Bot is alive ✅" });
    return;
  }

  try {
    await handler(req as any, res as any);
  } catch (err) {
    console.error("WEBHOOK CRASH:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
    res.status(200).json({ ok: true });
  }
}
