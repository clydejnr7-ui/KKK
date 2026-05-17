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

  // Keep support_step alive — user can send multiple messages without re-opening support
  await r().set(`support_step:${userId}`, true, { ex: 600 });

  // Clear any lingering user_replying state to avoid routing conflicts
  await r().del(`user_replying:${userId}`);

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
    `_You can keep typing more messages below, or tap the button to return to the menu._`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("🏠 Main Menu", "menu_main"),
    }
  );

  return true;
}

export async function handleUserReplyToSupport(ctx: Context): Promise<boolean> {
  const userId = ctx.from!.id;
  const active = await r().get(`user_replying:${userId}`);
  if (!active) return false;

  const text = (ctx.message as any)?.text?.trim() ?? "";
  if (!text || text.startsWith("/")) return false;

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

  // Keep user_replying alive — user can keep replying without tapping "💬 Reply" each time
  await r().set(`user_replying:${userId}`, true, { ex: 600 });

  await ctx.reply(
    `✅ *Message sent!*\n\nOur team will reply shortly.\n\n_You can keep typing below to send more messages._`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("🏠 Main Menu", "menu_main"),
    }
  );

  return true;
}

export function registerSupportHandlers(bot: Bot<Context>): void {

  // ── Admin clicks "Reply to User" ─────────────────────────────────────────
  bot.callbackQuery(/^support_reply_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = parseInt(ctx.match[1], 10);
    const adminChatId = ctx.chat!.id.toString();

    await r().set(`support_reply:${adminChatId}`, userId, { ex: 600 });

    await ctx.api.sendMessage(
      adminChatId,
      `✍️ <b>Reply to User ${userId}</b>\n\n` +
      `Type your messages in this chat — each one will be delivered directly to them.\n\n` +
      `<i>Type</i> <code>/cancel_reply</code> <i>to stop replying to this user.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // ── /cancel_reply ─────────────────────────────────────────────────────────
  bot.on(["message:text", "channel_post:text"], async (ctx, next: NextFunction) => {
    const adminChannelId = process.env.ADMIN_CHANNEL_ID;
    const chatId = ctx.chat?.id?.toString();
    if (!adminChannelId || chatId !== adminChannelId) { await next(); return; }

    const update = ctx.update as any;

    // CRITICAL: skip bot-generated channel posts — they have no `from` field.
    // Without this check, the bot's own "✅ Reply delivered" message re-triggers
    // this handler and creates an infinite delivery loop.
    const fromId = update.message?.from?.id ?? update.channel_post?.from?.id;
    if (!fromId) { await next(); return; }

    const text: string = (update.message?.text ?? update.channel_post?.text ?? "").trim();

    if (text === "/cancel_reply") {
      const had = await r().get(`support_reply:${chatId}`);
      await r().del(`support_reply:${chatId}`);
      await ctx.api.sendMessage(
        adminChannelId,
        had
          ? `✅ <b>Reply session ended.</b> You are no longer replying to user <code>${had}</code>.`
          : `ℹ️ No reply session was in progress.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    await next();
  });

  // ── Catch ALL admin text ──────────────────────────────────────────────────
  bot.on(["message:text", "channel_post:text"], async (ctx, next: NextFunction) => {
    const adminChannelId = process.env.ADMIN_CHANNEL_ID;
    const chatId = ctx.chat?.id?.toString();

    if (!adminChannelId || chatId !== adminChannelId) {
      await next();
      return;
    }

    const update = ctx.update as any;

    // CRITICAL: skip bot-generated channel posts — they have no `from` field.
    // The bot's confirmation messages ("✅ Reply delivered") are channel_post
    // events with no `from`. Without this guard they re-enter the handler,
    // deliver the confirmation text to the user, and spiral into a loop.
    const fromId = update.message?.from?.id ?? update.channel_post?.from?.id;
    if (!fromId) {
      await next();
      return;
    }

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

    // Refresh session TTL — keeps admin in reply mode without re-clicking
    await r().set(`support_reply:${chatId}`, targetUserId, { ex: 600 });

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
        `✅ <b>Reply delivered</b> to user <code>${targetUserId}</code>.\n\n` +
        `<i>Session active — keep typing to send more, or type</i> <code>/cancel_reply</code> <i>to end.</i>`,
        { parse_mode: "HTML" }
      );
    }
  });

  // ── User taps "💬 Reply" under an admin reply message ─────────────────────
  bot.callbackQuery(/^user_reply_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from!.id;
    await r().set(`user_replying:${userId}`, true, { ex: 600 });
    await ctx.reply(
      `✍️ *Type your reply below* and send it — it will go straight to the support team.\n\n_You can send as many messages as you need._`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard().text("❌ Cancel", "support_cancel"),
      }
    );
  });
}
