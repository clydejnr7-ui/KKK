import { Bot, Context, InlineKeyboard, NextFunction } from "grammy";
import { Redis } from "@upstash/redis";

function r(): Redis {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

export async function setSupportStep(userId: number): Promise<void> {
  await r().set(`support_step:${userId}`, true, { ex: 600 });
}

export async function clearSupportStep(userId: number): Promise<void> {
  await r().del(`support_step:${userId}`);
}

export async function handleSupportTextInput(ctx: Context): Promise<boolean> {
  const userId = ctx.from!.id;
  const active = await r().get(`support_step:${userId}`);
  if (!active) return false;

  const text = (ctx.message as any)?.text?.trim() ?? "";
  if (!text || text.startsWith("/")) return false;

  await clearSupportStep(userId);

  const name = ctx.from?.first_name ?? "User";
  const username = ctx.from?.username ? `@${ctx.from.username}` : "no username";

  try {
    await ctx.api.sendMessage(
      process.env.ADMIN_CHANNEL_ID!,
      `💬 <b>SUPPORT REQUEST</b>\n\n` +
      `👤 <b>${name}</b> (${username})\n` +
      `🆔 User ID: <code>${userId}</code>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📝 <b>Message:</b>\n\n${text}`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text(`✉️ Reply to ${name}`, `support_reply_${userId}`),
      }
    );
  } catch { /* non-fatal */ }

  await ctx.reply(
    `✅ *Message sent to support!*\n\n` +
    `Our team will reply to you here shortly.\n\n` +
    `_You can send another message anytime by tapping 💬 Support from the main menu._`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text("🏠 Main Menu", "menu_main"),
    }
  );

  return true;
}

export function registerSupportHandlers(bot: Bot<Context>): void {

  bot.callbackQuery(/^support_reply_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = parseInt(ctx.match[1], 10);
    const adminChatId = ctx.chat!.id.toString();

    await r().set(`support_reply:${adminChatId}`, userId, { ex: 600 });

    await ctx.reply(
      `✍️ <b>Reply to User</b>\n\n` +
      `Type your reply for user <code>${userId}</code>.\n` +
      `It will be delivered directly to them.\n\n` +
      `<i>Send /cancel_reply to abort.</i>`,
      { parse_mode: "HTML" }
    );
  });

  bot.command("cancel_reply", async (ctx) => {
    const adminChannelId = process.env.ADMIN_CHANNEL_ID;
    if (!adminChannelId || ctx.chat.id.toString() !== adminChannelId) return;

    const adminChatId = ctx.chat.id.toString();
    const pending = await r().get(`support_reply:${adminChatId}`);
    if (!pending) {
      await ctx.reply(`ℹ️ No reply in progress.`);
      return;
    }

    await r().del(`support_reply:${adminChatId}`);
    await ctx.reply(`✅ Reply cancelled. The user's message is still in the channel.`);
  });

  bot.on("message:text", async (ctx, next: NextFunction) => {
    const adminChannelId = process.env.ADMIN_CHANNEL_ID;

    if (!adminChannelId || ctx.chat.id.toString() !== adminChannelId) {
      await next();
      return;
    }

    const text = ctx.message.text.trim();
    if (text.startsWith("/")) {
      await next();
      return;
    }

    const adminChatId = ctx.chat.id.toString();
    const targetUserId = await r().get<number>(`support_reply:${adminChatId}`);

    if (!targetUserId) {
      await next();
      return;
    }

    await r().del(`support_reply:${adminChatId}`);

    try {
      await ctx.api.sendMessage(
        targetUserId,
        `💬 <b>Reply from Trading Flux Support</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${text}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>Reply to this by tapping 💬 Support in the main menu.</i>`,
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text("💬 Reply", "menu_support").row()
            .text("🏠 Main Menu", "menu_main"),
        }
      );

      await ctx.reply(
        `✅ <b>Reply delivered</b> to user <code>${targetUserId}</code>.`,
        { parse_mode: "HTML" }
      );
    } catch (e: any) {
      await ctx.reply(
        `❌ <b>Failed to deliver reply</b> to user <code>${targetUserId}</code>.\n\n` +
        `Reason: ${e?.message ?? "Unknown error"}\n\n` +
        `<i>The user may have blocked the bot.</i>`,
        { parse_mode: "HTML" }
      );
    }
  });
}
