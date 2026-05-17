import { Bot, Context, InlineKeyboard, NextFunction } from "grammy";
import { Redis } from "@upstash/redis";

function r(): Redis {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

const TTL = 1800; // 30 minutes

// Redis keys used:
//   support_open:{userId}      "1" — user opened support, can freely type messages
//   user_replying:{userId}     "1" — user tapped Reply, is in back-and-forth mode
//   admin_reply:{chatId}       userId — admin is replying to this user
//   admin_reply_msg:{chatId}   messageId — ID of the live status msg in admin chat

// ── Exported helpers for form.ts ─────────────────────────────────────────────

export async function setSupportStep(userId: number): Promise<void> {
  await r().set(`support_open:${userId}`, "1", { ex: TTL });
}

export async function clearSupportStep(userId: number): Promise<void> {
  await r().del(`support_open:${userId}`);
  await r().del(`user_replying:${userId}`);
}

// ── Called from form.ts message:text handler ─────────────────────────────────

// User typed a new support message after tapping "💬 Support"
export async function handleSupportTextInput(ctx: Context): Promise<boolean> {
  const userId = ctx.from!.id;
  const active = await r().get(`support_open:${userId}`);
  if (!active) return false;

  const text = (ctx.message as any)?.text?.trim() ?? "";
  if (!text || text.startsWith("/")) return false;

  // Keep session alive — user can send multiple messages without re-tapping Support
  await r().set(`support_open:${userId}`, "1", { ex: TTL });
  // Avoid routing conflict with reply mode
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
    `✅ *Message sent to support!*\n\nOur team will reply shortly.\n\n_Keep typing to send more._`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text("🏠 Main Menu", "menu_main"),
    }
  );

  return true;
}

// User typed a reply after receiving an admin message and tapping "💬 Reply"
export async function handleUserReplyToSupport(ctx: Context): Promise<boolean> {
  const userId = ctx.from!.id;
  const active = await r().get(`user_replying:${userId}`);
  if (!active) return false;

  const text = (ctx.message as any)?.text?.trim() ?? "";
  if (!text || text.startsWith("/")) return false;

  // Keep session alive — user can keep replying without re-tapping Reply
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
    `✅ *Sent!* Our team will reply shortly.\n\n_Keep typing to send more messages._`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text("🏠 Main Menu", "menu_main"),
    }
  );

  return true;
}

// ── Register all support bot handlers ────────────────────────────────────────

export function registerSupportHandlers(bot: Bot<Context>): void {

  // Admin clicks "✉️ Reply to User" button on a support message
  bot.callbackQuery(/^support_reply_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const targetUserId = parseInt(ctx.match[1], 10);
    const adminChatId = ctx.chat!.id.toString();

    await r().set(`admin_reply:${adminChatId}`, targetUserId, { ex: TTL });

    // Send a status message and store its ID so we can EDIT it on each delivery
    // instead of spamming new messages into the chat on every reply
    const sentMsg = await ctx.reply(
      `✍️ <b>Reply session open</b> → User <code>${targetUserId}</code>\n\n` +
      `Type messages below — each one is sent directly to the user.\n\n` +
      `<code>/done_reply</code> — end this session`,
      { parse_mode: "HTML" }
    );
    await r().set(`admin_reply_msg:${adminChatId}`, sentMsg.message_id, { ex: TTL });
  });

  // User taps "💬 Reply" button under an admin message
  bot.callbackQuery(/^user_reply_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from!.id;

    // Switch to reply mode — clear support_open to avoid dual routing
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

  // User cancels their support or reply session
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

  // ── Single unified handler for ALL admin chat text ────────────────────────
  // One handler (not two) eliminates Grammy middleware chain complexity.
  // No `fromId` filtering — it broke anonymous admin posts in supergroups.
  // Bots never receive their own messages per Telegram Bot API spec,
  // so no loop can occur from confirmation messages.
  bot.on(["message:text", "channel_post:text"], async (ctx, next: NextFunction) => {
    const adminChannelId = process.env.ADMIN_CHANNEL_ID;
    const chatId = ctx.chat?.id?.toString();

    // Only process messages from the configured admin chat
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

    if (!text) { await next(); return; }

    // /done_reply — admin ends the current reply session
    if (text === "/done_reply") {
      const had = await r().get<number>(`admin_reply:${chatId}`);
      await r().del(`admin_reply:${chatId}`);
      await r().del(`admin_reply_msg:${chatId}`);
      await ctx.api.sendMessage(
        adminChannelId,
        had
          ? `✅ <b>Reply session ended</b> for user <code>${had}</code>.`
          : `ℹ️ No active reply session.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // Pass other slash commands to other handlers (approve.ts etc.)
    if (text.startsWith("/")) { await next(); return; }

    // If approve.ts is waiting for a rejection reason, let it handle this
    const rejectPending = await r().get<number>(`reject_reason:${chatId}`);
    if (rejectPending) { await next(); return; }

    // Check if admin has an active reply session
    const targetUserId = await r().get<number>(`admin_reply:${chatId}`);
    if (!targetUserId) { await next(); return; }

    // Refresh session TTL — admin can keep typing without timing out
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
    } catch (e: any) {
      // Delivery failed — tell admin
      await ctx.api.sendMessage(
        adminChannelId,
        `❌ <b>Delivery failed</b> to <code>${targetUserId}</code>: ${e?.message ?? "Unknown error"}`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // ── Confirm delivery by EDITING the existing status message ─────────────
    // Using editMessageText instead of sendMessage means we never send new
    // messages into the admin chat on each delivery — no rate limit risk,
    // no potential re-triggering from bot messages appearing in the chat.
    const statusMsgId = await r().get<number>(`admin_reply_msg:${chatId}`);
    if (statusMsgId) {
      try {
        await ctx.api.editMessageText(
          parseInt(chatId),
          statusMsgId,
          `✍️ <b>Reply session open</b> → User <code>${targetUserId}</code>\n\n` +
          `✅ Last message delivered.\n\n` +
          `Keep typing to send more or <code>/done_reply</code> to end.`,
          { parse_mode: "HTML" }
        );
        return; // done — edited successfully
      } catch {
        // Edit failed (message too old, permissions) — fall through to new message
      }
    }

    // Fallback: send a new confirmation if edit was not possible
    await ctx.api.sendMessage(
      adminChannelId,
      `✅ Delivered to <code>${targetUserId}</code>. Keep typing or <code>/done_reply</code> to end.`,
      { parse_mode: "HTML" }
    );
  });
}
