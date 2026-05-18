import { Bot, Context, InlineKeyboard } from "grammy";
import { getAllActiveUserIds } from "./balance";
import { getFeeBalance } from "./deposit";
import { Redis } from "@upstash/redis";

function r(): Redis {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

function isAdminChannel(ctx: Context): boolean {
  const adminChannelId = process.env.ADMIN_CHANNEL_ID;
  return !!adminChannelId && ctx.chat?.id.toString() === adminChannelId;
}

const FEE_MESSAGE =
  `┌─────────────────────────┐\n` +
  `│  💳  WEEKLY FEE REMINDER  │\n` +
  `└─────────────────────────┘\n\n` +
  `Hey there\\! 👋 This is a reminder from *Trading Flux* management\\.\n\n` +
  `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
  `💵 *Amount Due:* $3\\.00 USDT\n` +
  `📅 *Frequency:* Weekly\n` +
  `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
  `Your weekly account management fee of *$3 USDT* is now due\\.\n\n` +
  `Please tap the button below to pay and keep your account active\\. ✅\n\n` +
  `_Failure to pay may pause your account management\\._`;

const FEE_KEYBOARD = {
  inline_keyboard: [
    [{ text: "💳 Pay Fee ($3)", callback_data: "menu_fee" }],
    [{ text: "🏠 Main Menu", callback_data: "menu_main" }],
  ],
};

async function sendFeeReminder(ctx: Context, userId: number): Promise<"ok" | "fail"> {
  try {
    await ctx.api.sendMessage(userId, FEE_MESSAGE, {
      parse_mode: "MarkdownV2",
      reply_markup: FEE_KEYBOARD,
    });
    return "ok";
  } catch {
    return "fail";
  }
}

export function registerNotifyHandlers(bot: Bot<Context>): void {

  // /fee <userId>  — send fee reminder to a single user
  bot.command("fee", async (ctx) => {
    if (!isAdminChannel(ctx)) return;

    const parts = (ctx.message?.text ?? (ctx as any).channelPost?.text ?? "").trim().split(/\s+/);
    const userId = parseInt(parts[1] ?? "", 10);

    if (!userId || isNaN(userId)) {
      await ctx.api.sendMessage(
        ctx.chat!.id,
        `⚠️ <b>Usage:</b> <code>/fee &lt;userId&gt;</code>\n\nExample: <code>/fee 7764271121</code>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const status = await sendFeeReminder(ctx, userId);
    await ctx.api.sendMessage(
      ctx.chat!.id,
      status === "ok"
        ? `✅ <b>Fee reminder sent</b> to user <code>${userId}</code>`
        : `❌ <b>Failed to send</b> to <code>${userId}</code> — user may have blocked the bot`,
      { parse_mode: "HTML" }
    );
  });

  // /feeall  — send fee reminder to ALL active accounts
  bot.command("feeall", async (ctx) => {
    if (!isAdminChannel(ctx)) return;

    const userIds = await getAllActiveUserIds();

    if (userIds.length === 0) {
      await ctx.api.sendMessage(ctx.chat!.id, `ℹ️ No active accounts found.`);
      return;
    }

    await ctx.api.sendMessage(
      ctx.chat!.id,
      `⏳ <b>Sending fee reminders to ${userIds.length} users...</b>`,
      { parse_mode: "HTML" }
    );

    let sent = 0;
    let failed = 0;
    const failedIds: number[] = [];

    for (const userId of userIds) {
      const status = await sendFeeReminder(ctx, userId);
      if (status === "ok") { sent++; } else { failed++; failedIds.push(userId); }
      await new Promise((r) => setTimeout(r, 100));
    }

    await ctx.api.sendMessage(
      ctx.chat!.id,
      `📊 <b>Fee Reminder Broadcast Complete</b>\n\n` +
      `✅ Sent:   <b>${sent}</b>\n` +
      `❌ Failed: <b>${failed}</b>\n` +
      (failedIds.length > 0
        ? `\n<b>Failed IDs:</b>\n${failedIds.map((id) => `<code>${id}</code>`).join(", ")}`
        : ``),
      { parse_mode: "HTML" }
    );
  });

  // /feecredit <userId> <amount>  — manually add to a user's fee wallet
  bot.command("feecredit", async (ctx) => {
    if (!isAdminChannel(ctx)) return;

    const parts = (ctx.message?.text ?? (ctx as any).channelPost?.text ?? "").trim().split(/\s+/);
    const userId = parseInt(parts[1] ?? "", 10);
    const amount = parseFloat(parts[2] ?? "");

    if (!userId || isNaN(userId) || isNaN(amount) || amount <= 0) {
      await ctx.api.sendMessage(
        ctx.chat!.id,
        `⚠️ <b>Usage:</b> <code>/feecredit &lt;userId&gt; &lt;amount&gt;</code>\n\n` +
        `Example: <code>/feecredit 7764271121 9</code>\n` +
        `<i>This credits $9 USDT to the user's fee wallet (3 weeks).</i>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const current = await getFeeBalance(userId);
    const newBal = parseFloat((current + amount).toFixed(2));
    await r().set(`fee_bal:${userId}`, newBal);

    const weeksCovered = Math.floor(newBal / 3);

    // Notify the user
    try {
      await ctx.api.sendMessage(
        userId,
        `╔═══════════════════════════╗\n` +
        `║  🎁  FEE CREDIT RECEIVED!  ║\n` +
        `╚═══════════════════════════╝\n\n` +
        `Our team has added *$${amount.toFixed(2)} USDT* to your fee wallet\\!\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💼 *Fee Wallet Balance:* $${newBal.toFixed(2)}\n` +
        `📅 *Weeks Covered:* ${weeksCovered}\n\n` +
        `You can now pay your weekly fee instantly with no crypto needed\\.`,
        {
          parse_mode: "MarkdownV2",
          reply_markup: {
            inline_keyboard: [
              [{ text: "💳 Pay Fee Now ($3)", callback_data: "menu_fee" }],
              [{ text: "🏠 Main Menu", callback_data: "menu_main" }],
            ],
          },
        }
      );
    } catch { /* user may have blocked the bot */ }

    await ctx.api.sendMessage(
      ctx.chat!.id,
      `✅ <b>Fee Credit Applied</b>\n\n` +
      `👤 User: <code>${userId}</code>\n` +
      `💰 Credited: <b>+$${amount.toFixed(2)} USDT</b>\n` +
      `💼 New Fee Balance: <b>$${newBal.toFixed(2)}</b>\n` +
      `📅 Weeks Covered: <b>${weeksCovered}</b>`,
      { parse_mode: "HTML" }
    );
  });
}
