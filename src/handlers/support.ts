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

// Called from form.ts when a user taps "💬 Reply" in a support reply from admin.
// Skips the prompt — user just types directly.
export async function handleUserReplyToSupport(ctx: Context): Promise<boolean> {
  const userId = ctx.from!.id;
  const active = await r().get(`user_replying:${userId}`);
  if (!active) return false;

  const text = (ctx.message as any)?.text?.trim() ?? "";
  if (!text || text.startsWith("/")) return false;

  await r().del(`user_replying:${userId}`);

  const name = ctx.from?.first_name ?? "User";
  const username = ctx.from?.username ? `@${ctx.from.username}` : "no username";

  try {
    await ctx.api.sendMessage(
      process.env.ADMIN_CHANNEL_ID!,
      `💬 <b>USER REPLY</b>\n\n` +
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
    `✅ *Message sent!*\n\nOur team will reply shortly.`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text("🏠 Main Menu", "menu_main"),
    }
  );

  return true;
}

export function registerSupportHandlers(bot: Bot<Context>): void {

  // ── Admin clicks "Reply to User" OR "Reply Again" ─────────────────────────
  bot.callbackQuery(/^support_reply_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = parseInt(ctx.match[1], 10);
    const adminChatId = ctx.chat!.id.toString();

    // Store: admin channel → target user ID
    await r().set(`support_reply:${adminChatId}`, userId, { ex: 600 });

    await ctx.api.sendMessage(
      adminChatId,
      `✍️ <b>Reply to User ${userId}</b>\n\n` +
      `Type your next message in this chat — it will be sent directly to them.\n\n` +
      `<i>Type</i> <code>/cancel_reply</code> <i>to abort.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // ── /cancel_reply — abort a pending reply ─────────────────────────────────
  bot.on(["message:text", "channel_post:text"], async (ctx, next: NextFunction) => {
    const adminChannelId = process.env.ADMIN_CHANNEL_ID;
    const chatId = ctx.chat?.id?.toString();
    if (!adminChannelId || chatId !== adminChannelId) { await next(); return; }

    const update = ctx.update as any;
    const text: string = (update.message?.text ?? update.channel_post?.text ?? "").trim();

    if (text === "/cancel_reply") {
      const had = await r().get(`support_reply:${chatId}`);
      await r().del(`support_reply:${chatId}`);
      await ctx.api.sendMessage(
        adminChannelId,
        had
          ? `✅ <b>Reply cancelled.</b>`
          : `ℹ️ No reply was in progress.`,
        { parse_mode: "HTML" }
      );
      return; // consumed — don't call next()
    }

    await next();
  });

  // ── Catch ALL admin text (groups + channels) ──────────────────────────────
  bot.on(["message:text", "channel_post:text"], async (ctx, next: NextFunction) => {
    const adminChannelId = process.env.ADMIN_CHANNEL_ID;
    const chatId = ctx.chat?.id?.toString();

    if (!adminChannelId || chatId !== adminChannelId) {
      await next();
      return;
    }

    const update = ctx.update as any;
    const text: string = (
      update.message?.text ??
      update.channel_post?.text ??
      ""
    ).trim();

    if (!text || text.startsWith("/")) {
      await next();
      return;
    }

    // If admin is typing a rejection reason — let approve.ts handle it
    const rejectPending = await r().get<number>(`reject_reason:${chatId}`);
    if (rejectPending) {
      await next();
      return;
    }

    const targetUserId = await r().get<number>(`support_reply:${chatId}`);
    if (!targetUserId) {
      await next();
      return;
    }

    // Delete AFTER we have the target — prevents double-delivery on retry
    await r().del(`support_reply:${chatId}`);

    let delivered = false;
    try {
      await ctx.api.sendMessage(
        targetUserId,
        `💬 <b>Reply from Trading Flux Support</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${text}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>Tap the button below to reply back.</i>`,
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text("💬 Reply", `user_reply_${targetUserId}`).row()
            .text("🏠 Main Menu", "menu_main"),
        }
      );
      delivered = true;
    } catch (e: any) {
      await ctx.api.sendMessage(
        adminChannelId,
        `❌ <b>Failed to deliver reply</b> to user <code>${targetUserId}</code>.\n\n` +
        `Reason: ${e?.message ?? "Unknown error"}\n\n` +
        `<i>The user may have blocked the bot.</i>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    if (delivered) {
      await ctx.api.sendMessage(
        adminChannelId,
        `✅ <b>Reply delivered</b> to user <code>${targetUserId}</code>.`,
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text(`✉️ Reply Again`, `support_reply_${targetUserId}`),
        }
      );
    }
  });

  // ── User taps "💬 Reply" under an admin reply message ─────────────────────
  bot.callbackQuery(/^user_reply_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from!.id;
    await r().set(`user_replying:${userId}`, true, { ex: 600 });
    await ctx.reply(
      `✍️ *Type your reply below* and send it — it will go straight to the support team.`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard().text("❌ Cancel", "support_cancel"),
      }
    );
  });
}
