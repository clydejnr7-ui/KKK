import { Bot, Context, InlineKeyboard, NextFunction } from "grammy";
import { Redis } from "@upstash/redis";

function r(): Redis {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

const TTL = 1800; // 30 minutes

// Redis keys:
//   support_open:{userId}      "1" — user opened support, can freely type
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

export async function handleSupportTextInput(ctx: Context): Promise<boolean> {
  const userId = ctx.from!.id;
  const active = await r().get(`support_open:${userId}`);
  if (!active) return false;

  const text = (ctx.message as any)?.text?.trim() ?? "";
  if (!text || text.startsWith("/")) return false;

  await r().set(`support_open:${userId}`, "1", { ex: TTL });
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

export async function handleUserReplyToSupport(ctx: Context): Promise<boolean> {
  const userId = ctx.from!.id;
  const active = await r().get(`user_replying:${userId}`);
  if (!active) return false;

  const text = (ctx.message as any)?.text?.trim() ?? "";
  if (!text || text.startsWith("/")) return false;

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

// ── Shared helper: update the admin's live status message ────────────────────

async function updateStatusMessage(
  api: Context["api"],
  adminChannelId: string,
  chatId: string,
  targetUserId: number,
  label: string
): Promise<void> {
  const statusMsgId = await r().get<number>(`admin_reply_msg:${chatId}`);
  if (statusMsgId) {
    try {
      await api.editMessageText(
        parseInt(chatId),
        statusMsgId,
        `✍️ <b>Reply session open</b> → User <code>${targetUserId}</code>\n\n` +
        `✅ ${label}\n\n` +
        `Keep typing to send more or <code>/done_reply</code> to end.`,
        { parse_mode: "HTML" }
      );
      return;
    } catch { /* fall through to new message */ }
  }
  await api.sendMessage(
    adminChannelId,
    `✅ ${label} — keep typing or <code>/done_reply</code> to end.`,
    { parse_mode: "HTML" }
  );
}

// ── Register all support bot handlers ────────────────────────────────────────

export function registerSupportHandlers(bot: Bot<Context>): void {

  // Admin clicks "✉️ Reply to User" button
  bot.callbackQuery(/^support_reply_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const targetUserId = parseInt(ctx.match[1], 10);
    const adminChatId = ctx.chat!.id.toString();

    await r().set(`admin_reply:${adminChatId}`, targetUserId, { ex: TTL });

    const sentMsg = await ctx.reply(
      `✍️ <b>Reply session open</b> → User <code>${targetUserId}</code>\n\n` +
      `Type messages or send files (PDF, images, etc.) — everything goes directly to the user.\n\n` +
      `<code>/done_reply</code> — end this session`,
      { parse_mode: "HTML" }
    );
    await r().set(`admin_reply_msg:${adminChatId}`, sentMsg.message_id, { ex: TTL });
  });

  // User taps "💬 Reply" button
  bot.callbackQuery(/^user_reply_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from!.id;

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

  // User cancels
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

  // ── Admin text messages ───────────────────────────────────────────────────
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

    if (!text) { await next(); return; }

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

    if (text.startsWith("/")) { await next(); return; }

    const rejectPending = await r().get<number>(`reject_reason:${chatId}`);
    if (rejectPending) { await next(); return; }

    const targetUserId = await r().get<number>(`admin_reply:${chatId}`);
    if (!targetUserId) { await next(); return; }

    await r().set(`admin_reply:${chatId}`, targetUserId, { ex: TTL });

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
      await ctx.api.sendMessage(
        adminChannelId,
        `❌ <b>Delivery failed</b> to <code>${targetUserId}</code>: ${e?.message ?? "Unknown error"}`,
        { parse_mode: "HTML" }
      );
      return;
    }

    await updateStatusMessage(ctx.api, adminChannelId, chatId, targetUserId, "Text message delivered.");
  });

  // ── Admin document/file messages (PDF, HTML, images, video, audio, etc.) ──
  // This is the handler that was completely missing before.
  // It mirrors the text handler but uses forwardMessage + sendDocument/sendPhoto
  // depending on what type of file was sent.
  bot.on(
    [
      "message:document",
      "channel_post:document",
      "message:photo",
      "channel_post:photo",
      "message:video",
      "channel_post:video",
      "message:audio",
      "channel_post:audio",
      "message:voice",
      "channel_post:voice",
      "message:sticker",
      "channel_post:sticker",
    ],
    async (ctx, next: NextFunction) => {
      const adminChannelId = process.env.ADMIN_CHANNEL_ID;
      const chatId = ctx.chat?.id?.toString();

      if (!adminChannelId || chatId !== adminChannelId) {
        await next();
        return;
      }

      const rejectPending = await r().get<number>(`reject_reason:${chatId}`);
      if (rejectPending) { await next(); return; }

      const targetUserId = await r().get<number>(`admin_reply:${chatId}`);
      if (!targetUserId) { await next(); return; }

      await r().set(`admin_reply:${chatId}`, targetUserId, { ex: TTL });

      const update = ctx.update as any;
      const msg = update.message ?? update.channel_post;
      const caption = msg?.caption ?? undefined;

      // Build the reply keyboard for the user
      const replyMarkup = new InlineKeyboard()
        .text("💬 Reply", `user_reply_${targetUserId}`).row()
        .text("🏠 Main Menu", "menu_main");

      try {
        if (msg?.document) {
          await ctx.api.sendDocument(targetUserId, msg.document.file_id, {
            caption: caption
              ? `💬 <b>From Trading Flux Support</b>\n\n${caption}`
              : `💬 <b>File from Trading Flux Support</b>`,
            parse_mode: "HTML",
            reply_markup: replyMarkup,
          });
        } else if (msg?.photo) {
          // Telegram sends multiple photo sizes — use the last (largest)
          const photo = msg.photo[msg.photo.length - 1];
          await ctx.api.sendPhoto(targetUserId, photo.file_id, {
            caption: caption
              ? `💬 <b>From Trading Flux Support</b>\n\n${caption}`
              : `💬 <b>Image from Trading Flux Support</b>`,
            parse_mode: "HTML",
            reply_markup: replyMarkup,
          });
        } else if (msg?.video) {
          await ctx.api.sendVideo(targetUserId, msg.video.file_id, {
            caption: caption
              ? `💬 <b>From Trading Flux Support</b>\n\n${caption}`
              : `💬 <b>Video from Trading Flux Support</b>`,
            parse_mode: "HTML",
            reply_markup: replyMarkup,
          });
        } else if (msg?.audio) {
          await ctx.api.sendAudio(targetUserId, msg.audio.file_id, {
            caption: caption
              ? `💬 <b>From Trading Flux Support</b>\n\n${caption}`
              : undefined,
            parse_mode: "HTML",
            reply_markup: replyMarkup,
          });
        } else if (msg?.voice) {
          await ctx.api.sendVoice(targetUserId, msg.voice.file_id, {
            caption: caption ?? undefined,
            reply_markup: replyMarkup,
          });
        } else if (msg?.sticker) {
          await ctx.api.sendSticker(targetUserId, msg.sticker.file_id, {
            reply_markup: replyMarkup,
          });
        } else {
          await next();
          return;
        }
      } catch (e: any) {
        await ctx.api.sendMessage(
          adminChannelId,
          `❌ <b>File delivery failed</b> to <code>${targetUserId}</code>: ${e?.message ?? "Unknown error"}`,
          { parse_mode: "HTML" }
        );
        return;
      }

      const fileType = msg?.document
        ? (msg.document.file_name ?? "File")
        : msg?.photo
        ? "Image"
        : msg?.video
        ? "Video"
        : msg?.audio
        ? "Audio"
        : msg?.voice
        ? "Voice message"
        : "Sticker";

      await updateStatusMessage(
        ctx.api,
        adminChannelId,
        chatId,
        targetUserId,
        `${fileType} delivered.`
      );
    }
  );
}
