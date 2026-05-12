import { Bot, Context, InlineKeyboard, NextFunction } from "grammy";
import { Redis } from "@upstash/redis";
import { getPending, removePending } from "../pending";
import { registerAccount } from "./balance";
import { connectAndValidate } from "../utils/metaapi";
import { formatUSD } from "../utils/balance";

function r(): Redis {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

export function registerApproveHandler(bot: Bot<Context>): void {

  // ── ✅ Approve (with MetaAPI verification) ───────────────────────────────
  bot.callbackQuery(/^approve_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery("⏳ Verifying...");
    const userId = parseInt(ctx.match[1], 10);
    const pending = await getPending(userId);

    if (!pending) {
      await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
      await ctx.reply(
        `⚠️ <b>No pending submission</b> found for user <code>${userId}</code>.\n\nThey may already be approved or the submission expired.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard().text("⏳ Verifying credentials...", "noop"),
    });

    await ctx.reply(
      `🔄 <b>Verifying credentials with broker...</b>\n\n` +
      `👤 <b>${pending.fullName}</b>\n` +
      `🖥 ${pending.platform} — ${pending.brokerName}\n` +
      `🏦 Server: <code>${pending.serverName}</code>\n` +
      `🔑 Login: <code>${pending.accountNumber}</code>\n\n` +
      `⏳ This may take up to 90 seconds...`,
      { parse_mode: "HTML" }
    );

    const result = await connectAndValidate({
      userId,
      accountNumber: pending.accountNumber ?? "",
      password: pending.password ?? "",
      investorPassword: pending.investorPassword,
      serverName: pending.serverName ?? "",
      platform: (pending.platform as "MT4" | "MT5") ?? "MT5",
    });

    if (!result.success) {
      await ctx.editMessageReplyMarkup({
        reply_markup: new InlineKeyboard()
          .text("🔁 Retry Verify", `approve_${userId}`).row()
          .text("✅ Manual Override", `manual_${userId}`)
          .text("❌ Reject", `reject_${userId}`),
      });
      await ctx.reply(
        `❌ <b>Credential Verification FAILED</b>\n\n` +
        `👤 ${pending.fullName} (ID: <code>${userId}</code>)\n\n` +
        `<b>Error:</b> ${result.error}\n\n` +
        `<b>Submitted credentials:</b>\n` +
        `  Login:    <code>${pending.accountNumber}</code>\n` +
        `  Server:   <code>${pending.serverName}</code>\n` +
        `  Platform: ${pending.platform}\n\n` +
        `<i>Use ✅ Manual Override to approve without MetaAPI verification.</i>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const deposit = parseFloat(pending.depositAmount ?? "0");
    const startDate = pending.startDate ? new Date(pending.startDate) : new Date();

    await registerAccount(
      userId, deposit, startDate,
      pending.fullName ?? "Trader",
      pending.platform, pending.brokerName,
      pending.accountNumber, pending.email,
      result.metaApiAccountId, pending.serverName
    );
    await removePending(userId);

    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard().text("✅ Approved", "noop"),
    });

    const balanceLine = result.balance
      ? `💰 Live Balance: *${result.balance.currency} ${formatUSD(result.balance.balance)}*\n📊 Equity: *${result.balance.currency} ${formatUSD(result.balance.equity)}*\n`
      : `💰 Deposit: *$${pending.depositAmount}*\n`;

    try {
      await ctx.api.sendMessage(userId,
        `╔═══════════════════════════╗\n║  ✅  ACCOUNT APPROVED!     ║\n╚═══════════════════════════╝\n\n` +
        `🎉 Congratulations, *${pending.fullName}*!\n\nYour MT4/MT5 account has been verified and *activated*.\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n📋 *Your Account*\n   Platform: *${pending.platform}*\n   Broker: *${pending.brokerName}*\n   Server: \`${pending.serverName}\`\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n📈 *Live Data*\n${balanceLine}\nTap below to open your live balance dashboard. 📊`,
        { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("📊 View Live Balance", "menu_balance").row().text("💰 Deposit More", "menu_deposit") }
      );
    } catch (e) { console.error(`Failed to notify user ${userId}:`, e); }

    await ctx.reply(
      `✅ <b>Account Activated &amp; Verified</b>\n\n` +
      `👤 <b>${pending.fullName ?? "Trader"}</b>\n` +
      `🆔 User ID: <code>${userId}</code>\n` +
      `💵 Deposit: <b>$${pending.depositAmount}</b>\n` +
      `📅 Start: ${pending.startDate}\n` +
      `🖥 ${pending.platform} — ${pending.brokerName}\n\n` +
      `User has been notified. Dashboard is now live.`,
      { parse_mode: "HTML" }
    );
  });

  // ── ✅ Manual Override (skip MetaAPI, approve directly) ──────────────────
  bot.callbackQuery(/^manual_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery("✅ Manual override applied");
    const userId = parseInt(ctx.match[1], 10);
    const pending = await getPending(userId);

    if (!pending) {
      await ctx.reply(`⚠️ No pending submission for <code>${userId}</code>.`, { parse_mode: "HTML" });
      return;
    }

    const deposit = parseFloat(pending.depositAmount ?? "0");
    const startDate = pending.startDate ? new Date(pending.startDate) : new Date();

    await registerAccount(
      userId, deposit, startDate,
      pending.fullName ?? "Trader",
      pending.platform, pending.brokerName,
      pending.accountNumber, pending.email,
      undefined,
      pending.serverName
    );
    await removePending(userId);

    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard().text("✅ Manually Approved", "noop"),
    });

    try {
      await ctx.api.sendMessage(userId,
        `╔═══════════════════════════╗\n║  ✅  ACCOUNT APPROVED!     ║\n╚═══════════════════════════╝\n\n` +
        `🎉 Congratulations, *${pending.fullName}*!\n\nYour account has been manually reviewed and *activated* by our team.\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n📋 *Your Account*\n   Platform: *${pending.platform}*\n   Broker: *${pending.brokerName}*\n   Server: \`${pending.serverName}\`\n\n` +
        `💰 Deposit: *$${pending.depositAmount}*\n\nTap below to view your dashboard. 📊`,
        { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("📊 View Live Balance", "menu_balance").row().text("🏠 Main Menu", "menu_main") }
      );
    } catch (e) { console.error(`Failed to notify user ${userId}:`, e); }

    await ctx.reply(
      `✅ <b>Manually Approved</b> (MetaAPI verification bypassed)\n\n` +
      `👤 <b>${pending.fullName}</b>\n` +
      `🆔 <code>${userId}</code>\n` +
      `💵 $${pending.depositAmount} — ${pending.platform} ${pending.brokerName}\n\n` +
      `⚠️ <i>Balance uses calculated projections. MetaAPI verification was skipped.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // ── ❌ Reject button — ask admin for reason ───────────────────────────────
  bot.callbackQuery(/^reject_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = parseInt(ctx.match[1], 10);
    const pending = await getPending(userId);

    if (!pending) {
      await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
      await ctx.reply(`⚠️ No pending submission for <code>${userId}</code>.`, { parse_mode: "HTML" });
      return;
    }

    const adminChatId = ctx.chat!.id.toString();
    await r().set(`reject_reason:${adminChatId}`, userId, { ex: 300 });

    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard()
        .text("✅ Approve", `approve_${userId}`)
        .text("⏳ Awaiting reason...", "noop"),
    });

    await ctx.reply(
      `✍️ <b>Rejection Reason</b>\n\n` +
      `Please type the rejection reason for <b>${pending.fullName}</b> (ID: <code>${userId}</code>).\n\n` +
      `This message will be sent directly to the user.\n\n` +
      `<i>You have 5 minutes. Send /cancel_reject to abort.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // ── Cancel rejection ──────────────────────────────────────────────────────
  bot.command("cancel_reject", async (ctx) => {
    const adminChannelId = process.env.ADMIN_CHANNEL_ID;
    if (ctx.chat.id.toString() !== adminChannelId) return;

    const adminChatId = ctx.chat.id.toString();
    const pending = await r().get(`reject_reason:${adminChatId}`);
    if (!pending) {
      await ctx.reply(`ℹ️ No rejection in progress.`);
      return;
    }

    await r().del(`reject_reason:${adminChatId}`);
    await ctx.reply(`✅ Rejection cancelled. The submission is still pending.`);
  });

  // ── Capture rejection reason from admin's next text message ───────────────
  bot.on("message:text", async (ctx, next: NextFunction) => {
    const adminChannelId = process.env.ADMIN_CHANNEL_ID;
    if (!adminChannelId || ctx.chat.id.toString() !== adminChannelId) {
      await next();
      return;
    }

    const text = ctx.message.text.trim();
    if (text.startsWith("/")) { await next(); return; }

    const adminChatId = ctx.chat.id.toString();
    const pendingUserId = await r().get<number>(`reject_reason:${adminChatId}`);
    if (!pendingUserId) { await next(); return; }

    await r().del(`reject_reason:${adminChatId}`);

    const pending = await getPending(pendingUserId);
    if (!pending) {
      await ctx.reply(`⚠️ Submission for user <code>${pendingUserId}</code> no longer exists.`, { parse_mode: "HTML" });
      return;
    }

    await removePending(pendingUserId);

    try {
      await ctx.api.sendMessage(pendingUserId,
        `╔═══════════════════════════╗\n║  ❌  APPLICATION REJECTED  ║\n╚═══════════════════════════╝\n\n` +
        `Hi *${pending.fullName}*, unfortunately your account submission has been reviewed and could not be approved.\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n📋 *Reason from our team:*\n\n_${text}_\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Please correct the issue and re-submit, or contact support for help.`,
        { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("📝 Re-submit", "menu_register").row().text("💬 Support", "menu_support") }
      );
    } catch (e) { console.error(`Could not notify user ${pendingUserId}:`, e); }

    await ctx.reply(
      `❌ <b>Submission Rejected</b>\n\n` +
      `👤 <b>${pending.fullName}</b>\n` +
      `🆔 <code>${pendingUserId}</code>\n\n` +
      `📋 <b>Reason sent:</b>\n<i>${text}</i>\n\n` +
      `User has been notified.`,
      { parse_mode: "HTML" }
    );
  });

  // ── Noop for disabled buttons ─────────────────────────────────────────────
  bot.callbackQuery("noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });
}
