import { VercelRequest, VercelResponse } from "@vercel/node";

export default async function checkWebhook(req: VercelRequest, res: VercelResponse) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    res.status(500).json({ error: "TELEGRAM_BOT_TOKEN not configured" });
    return;
  }

  const [webhookRes, meRes] = await Promise.all([
    fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`),
    fetch(`https://api.telegram.org/bot${token}/getMe`),
  ]);

  const webhook = await webhookRes.json() as any;
  const me = await meRes.json() as any;

  const info = webhook.result ?? {};
  const bot = me.result ?? {};

  const status = {
    bot: {
      username: bot.username ? `@${bot.username}` : "unknown",
      name: bot.first_name ?? "unknown",
      id: bot.id ?? "unknown",
    },
    webhook: {
      url: info.url || "❌ NOT SET",
      active: !!info.url,
      pending_updates: info.pending_update_count ?? 0,
      last_error: info.last_error_message
        ? `❌ ${info.last_error_message} (${new Date((info.last_error_date ?? 0) * 1000).toUTCString()})`
        : "✅ No errors",
      max_connections: info.max_connections ?? "default",
      ip_address: info.ip_address ?? "unknown",
    },
    env: {
      TELEGRAM_BOT_TOKEN: "✅ set",
      ADMIN_CHANNEL_ID: process.env.ADMIN_CHANNEL_ID ? "✅ set" : "❌ missing",
      WEBHOOK_URL: process.env.WEBHOOK_URL ? "✅ set" : "❌ missing",
      META_API_TOKEN: process.env.META_API_TOKEN ? "✅ set" : "❌ missing",
      UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL ? "✅ set" : "❌ missing",
      UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN ? "✅ set" : "❌ missing",
    },
  };

  res.status(200).json(status);
}
