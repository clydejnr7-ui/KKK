import { VercelRequest, VercelResponse } from "@vercel/node";
import { bot } from "../src/index";

let initialized = false;

export default async function webhook(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(200).json({ status: "Trading Flux Bot is alive ✅" });
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
