import { Bot, Context, InlineKeyboard, NextFunction } from "grammy";
import { Redis } from "@upstash/redis";

function r(): Redis {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

// 30 minute session TTL — long enough for real conversations
const TTL = 1800;

// ─── Exported helpers (called from form.ts) ───────────────────────────────────

export async function setSupportStep(userId: number): Promise<void> {
  await r().set(`support_open:${userId}`, "1", { ex: TTL });
}

export async function clearSupportStep(userId: number): Promise<void> {
  await r().del(`support_open:${userId}`);
  await r().del(`user_replying:${userId}`);
}

// ─── Called from form.ts message:text handler ────────────────────────────────

// Handles user typing a NEW support message (after tapping "💬 Support")
export async function handleSupportTextInput(ctx: Context): Promise<boolean> {
  const userId = ctx.from!.id;
  const active = await r().get(`support_open:${userId}`);
  if (!active) return false;

  const text = (ctx.message as any)?.text?.trim() ?? "";
  if (!text || text.startsWith("/")) return false;

  // Refresh session — user can send multiple messages without re-tapping Support
  await r().set(`support_open:${userId}`, "1", { ex: TTL });
  // Clear reply mode to avoid routing conflict
  await r().del(`user_replying:${userId}`);

  const name = ctx.from?.first_name ?? "User";
  const username = ctx.from?.username ? `@${ctx.from.username}` : "no username";

  try {
    await ctx.api.sendMessage(
      process.env.ADMIN_CHANNEL_ID!,
      `💬 <b>SUPPORT MESSAGE</b>\n\n` +
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
    `_You can keep typing more messages below._`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text("🏠 Main Menu", "menu_main"),
    }
  );

  return true;
}

// Handles user typing a REPLY to an admin message (after tapping "💬 Reply")
export async function handleUserReplyToSupport(ctx: Context): Promise<boolean> {
  const userId = ctx.from!.id;
  const active = await r().get(`user_replying:${userId}`);
  if (!active) return false;

  const text = (ctx.message as any)?.text?.trim() ?? "";
  if (!text || text.startsWith("/")) return false;

  // Refresh session — user can send multiple replies without re-tapping Reply
  await r().set(`user_replying:${userId}`, "1", { ex: TTL });

  const name = ctx.from?.first_name ?? "User";
  const username = ctx.from?.username ? `@${ctx.from.username}` : "no username";

  try {
    await ctx.api.sendMessage(
      process.env.ADMIN_CHANNEL_ID!,
      `↩️ <b>USER REPLY</b>\n\n` +
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
    `✅ *Message sent!*\n\nOur team will reply shortly.\n\n_Keep typing to send more messages._`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text("🏠 Main Menu", "menu_main"),
    }
  );

  return true;
}

// ─── Register support bot handlers ───────────────────────────────────────────

export function registerSupportHandlers(bot: Bot<Context>): void {

  // Admin clicks "✉️ Reply to User" button on a support message
  bot.callbackQuery(/^support_reply_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const targetUserId = parseInt(ctx.match[1], 10);
    const adminChatId = ctx.chat!.id.toString();

    // Store who the admin is replying to
    await r().set(`admin_reply:${adminChatId}`, targetUserId, { ex: TTL });

    await ctx.reply(
      `✍️ <b>Reply session started</b> → User <code>${targetUserId}</code>\n\n` +
      `Type your messages below. Each one is delivered directly.\n\n` +
      `Type <code>/done_reply</code> to end this session.`,
      { parse_mode: "HTML" }
    );
  });

  // User taps "💬 Reply" button under an admin reply
  bot.callbackQuery(/^user_reply_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from!.id;

    // Reply mode takes over — clear support_open to avoid dual routing
    await r().del(`support_open:${userId}`);
    await r().set(`user_replying:${userId}`, "1", { ex: TTL });

    await ctx.reply(
      `✍️ *Type your reply below* — it goes straight to our support team.\n\n` +
      `_Keep typing to send as many messages as you need._`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard().text("❌ Cancel", "support_cancel"),
      }
    );
  });

  // User cancels their support session
  bot.callbackQuery("support_cancel", async (ctx) => {
    await ctx.answerCallbackQuery("Cancelled");
    const userId = ctx.from!.id;
    await r().del(`support_open:${userId}`);
    await r().del(`user_replying:${userId}`);
    await ctx.reply(`✅ *Cancelled.*`, {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text("🏠 Main Menu", "menu_main"),
    });
  });

  // ── Single unified handler for ALL text from the admin chat ──────────────
  // Using one handler instead of two prevents middleware chain confusion.
  // No `fromId` filtering — that broke anonymous admin posts in supergroups.
  // Bots do not receive their own messages per Telegram Bot API spec, so
  // the delivery confirmations we send here cannot re-trigger this handler.
  bot.on(["message:text", "channel_post:text"], async (ctx, next: NextFunction) => {
    const adminChannelId = process.env.ADMIN_CHANNEL_ID;
    const chatId = ctx.chat?.id?.toString();

    // Only handle messages coming from the admin chat
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

    if (!text) {
      await next();
      return;
    }

    // /done_reply — admin ends the current reply session
    if (text === "/done_reply") {
      const had = await r().get<number>(`admin_reply:${chatId}`);
      await r().del(`admin_reply:${chatId}`);
      await ctx.api.sendMessage(
        adminChannelId,
        had
          ? `✅ <b>Reply session ended</b> for user <code>${had}</code>.`
          : `ℹ️ No active reply session.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // Skip other slash commands — let approve.ts and others handle them
    if (text.startsWith("/")) {
      await next();
      return;
    }

    // If approve.ts is waiting for a rejection reason, let it handle this
    const rejectPending = await r().get<number>(`reject_reason:${chatId}`);
    if (rejectPending) {
      await next();
      return;
    }

    // Check if admin has an active reply session
    const targetUserId = await r().get<number>(`admin_reply:${chatId}`);
    if (!targetUserId) {
      await next();
      return;
    }

    // Refresh the session TTL so admin can keep replying without timeout
    await r().set(`admin_reply:${chatId}`, targetUserId, { ex: TTL });

    // Deliver the message to the user
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

      // Confirm delivery — safe because bots do not receive their own messages
      await ctx.api.sendMessage(
        adminChannelId,
        `✅ Delivered to <code>${targetUserId}</code> — keep typing or type <code>/done_reply</code> to end.`,
        { parse_mode: "HTML" }
      );
    } catch (e: any) {
      await ctx.api.sendMessage(
        adminChannelId,
        `❌ <b>Failed to deliver</b> to <code>${targetUserId}</code>\n\nReason: ${e?.message ?? "Unknown"}\n\n<i>The user may have blocked the bot.</i>`,
        { parse_mode: "HTML" }
      );
    }
  });
}
