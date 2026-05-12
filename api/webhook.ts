import { VercelRequest, VercelResponse } from "@vercel/node";
import { Bot } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN!;
const bot = new Bot(token);

bot.command("start", async (ctx) => {
  await ctx.reply("✅ Bot is alive and responding!");
});

bot.on("message", async (ctx) => {
  await ctx.reply("📨 Got your message: " + ctx.message.text);
});

let initialized = false;

export default async function webhook(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(200).json({ ok: true });
    return;
  }
  try {
    if (!initialized) {
      await bot.init();
      initialized = true;
    }
    await bot.handleUpdate(req.body);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("WEBHOOK CRASH:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
    res.status(200).json({ ok: true });
  }
}
