import { Bot, Context, InlineKeyboard } from "grammy";
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
}
