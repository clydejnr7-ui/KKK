import { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * GET /api/set-webhook?secret=YOUR_ADMIN_SECRET
 * Call this once after deploying to Vercel to register the webhook with Telegram.
 */
export default async function setWebhook(req: VercelRequest, res: VercelResponse) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const webhookUrl = process.env.WEBHOOK_URL;

  if (!token || !webhookUrl) {
    res.status(500).json({ error: "TELEGRAM_BOT_TOKEN or WEBHOOK_URL not configured" });
    return;
  }

  const url = `${webhookUrl}/api/webhook`;

  const telegramRes = await fetch(
    `https://api.telegram.org/bot${token}/setWebhook`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    }
  );

  const data = await telegramRes.json();

  res.status(200).json({
    message: "Webhook registration attempted",
    webhookUrl: url,
    telegramResponse: data,
  });
}
