import { VercelRequest, VercelResponse } from "@vercel/node";
import { webhookCallback } from "grammy";
import { bot } from "../src/index";

// Vercel serverless function — handles Telegram webhook POST requests
const handler = webhookCallback(bot, "std/http");

export default async function webhook(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(200).json({ status: "Trading Flux Bot is alive ✅" });
    return;
  }

  try {
    // grammy's webhookCallback expects a standard Request/Response
    // We adapt Vercel's req/res to the standard Web API
    const body = JSON.stringify(req.body);
    const request = new Request("https://webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    const response = await handler(request);
    const text = await response.text();

    res.status(response.status).send(text || "OK");
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
