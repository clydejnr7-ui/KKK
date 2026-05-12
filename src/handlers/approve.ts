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

  // ── ✅ Approve button ────────────────────────────────────────────────────
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
          .text("🔁 Retry Approve", `approve_${userId}`)
          .text("❌ Reject", `reject_${userId}`),
      });
      await ctx.reply(
        `❌ <b>Credential Verification FAILED</b>\n\n` +
        `👤 ${pending.fullName} (ID: <code>${userId}</code>)\n\n` +
        `<b>Error:</b> ${result.error}\n\n` +
        `<b>Submitted credentials:</b>\n` +
        `  Login:    <code>${pending.accountNumber}</code>\n` +
        `  Server:   <code>${pending.serverName}</code>\n` +
        `  Platform: ${pending.platform}`,
        { parse_mode: "HTML" }
      );
      try {
        await ctx.api.sendMessage(userId,
          `╔═══════════════════════════╗\n║  ❌  CREDENTIALS INVALID   ║\n╚═══════════════════════════╝\n\n` +
          `Hi *${pending.fullName}*, our team attempted to connect to your account but the credentials could not be verified.\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚠️ *Possible causes:*\n\n  • Wrong login/account number\n  • Incorrect password\n  • Wrong server name\n  • Wrong platform (MT4 vs MT5)\n\n` +
          `Please re-submit with corrected details using /register`,
          { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("📝 Re-submit Credentials", "menu_register").row().text("🏠 Main Menu", "menu_main") }
        );
      } catch (e) { console.error(`Could not notify user ${userId}:`, e); }
      return;
    }

    const deposit = parseFloat(pending.depositAmount ?? "0");
    const startDate = pending.startDate ? new Date(pending.startDate) : new Date();
    const live = result.balance;

    await registerAccount(userId, deposit, startDate, pending.fullName ?? "Trader", pending.platform, pending.brokerName, pending.accountNumber, pending.email, result.metaApiAccountId, pending.serverName);
    await removePending(userId);

    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard().text("✅ Approved", "noop"),
    });

    const balanceLine = live
      ? `💰 Live Balance: *${live.currency} ${formatUSD(live.balance)}*\n📊 Equity: *${live.currency} ${formatUSD(live.equity)}*\n`
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

    const liveInfo = live
      ? `\n\n💰 <b>Live Broker Data</b>\n   Balance: <b>${live.currency} ${formatUSD(live.balance)}</b>\n   Equity: ${live.currency} ${formatUSD(live.equity)}\n` +
        (live.leverage ? `   Leverage: 1:${live.leverage}` : "")
      : "";

    await ctx.reply(
      `✅ <b>Account Activated &amp; Verified</b>\n\n👤 <b>${pending.fullName ?? "Trader"}</b>\n` +
      `🆔 User ID: <code>${userId}</code>\n💵 Deposit: <b>$${pending.depositAmount}</b>\n` +
      `📅 Start: ${pending.startDate}\n🖥 ${pending.platform} — ${pending.brokerName}${liveInfo}\n\n` +
      `🔗 MetaAPI ID: <code>${result.metaApiAccountId}</code>\n\nUser has been notified. Dashboard is now live.`,
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

    // Store rejection intent in Redis keyed by admin chat ID (5 min TTL)
    const adminChatId = ctx.chat!.id.toString();
    await r().set(`reject_reason:${adminChatId}`, userId, { ex: 300 });

    // Update original message buttons to show waiting state
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
    const adminChatId = ctx.chat.id.toString();
    const adminChannelId = process.env.ADMIN_CHANNEL_ID;
    if (ctx.chat.id.toString() !== adminChannelId) return;

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

    // We have a rejection reason — process it
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
