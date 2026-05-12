import { Bot, Context, InlineKeyboard } from "grammy";
import { getPending, removePending } from "../pending";
import { registerAccount } from "./balance";
import { connectAndValidate } from "../utils/metaapi";
import { formatUSD } from "../utils/balance";

export function registerApproveHandler(bot: Bot<Context>): void {
  bot.on("message:text", async (ctx) => {
    const adminChannelId = process.env.ADMIN_CHANNEL_ID;
    if (!adminChannelId) return;

    // Only act in the admin channel
    if (ctx.chat.id.toString() !== adminChannelId) return;

    const text = ctx.message.text.trim();
    const match = text.match(/^\/approve_(\d+)$/i);
    if (!match) return;

    const userId = parseInt(match[1], 10);
    const pending = getPending(userId);

    if (!pending) {
      await ctx.reply(
        `⚠️ <b>No pending submission</b> found for user <code>${userId}</code>.\n\n` +
        `They may already be approved or the bot was restarted (in-memory cleared).`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // ── Step 1: Tell admin we're verifying ────────────────────────────────────
    await ctx.reply(
      `🔄 <b>Verifying credentials with broker...</b>\n\n` +
      `👤 <b>${pending.fullName}</b>\n` +
      `🖥 ${pending.platform} — ${pending.brokerName}\n` +
      `🏦 Server: <code>${pending.serverName}</code>\n` +
      `🔑 Login: <code>${pending.accountNumber}</code>\n\n` +
      `⏳ Connecting to broker server. This may take up to 90 seconds...`,
      { parse_mode: "HTML" }
    );

    // ── Step 2: Connect to MetaAPI and validate ───────────────────────────────
    const result = await connectAndValidate({
      userId,
      accountNumber: pending.accountNumber ?? "",
      password: pending.password ?? "",
      investorPassword: pending.investorPassword,
      serverName: pending.serverName ?? "",
      platform: (pending.platform as "MT4" | "MT5") ?? "MT5",
    });

    // ── Step 3a: Credentials invalid ─────────────────────────────────────────
    if (!result.success) {
      // Tell admin
      await ctx.reply(
        `❌ <b>Credential Verification FAILED</b>\n\n` +
        `👤 ${pending.fullName} (ID: <code>${userId}</code>)\n\n` +
        `<b>Error:</b> ${result.error}\n\n` +
        `<b>Submitted credentials:</b>\n` +
        `  Login:    <code>${pending.accountNumber}</code>\n` +
        `  Server:   <code>${pending.serverName}</code>\n` +
        `  Platform: ${pending.platform}\n\n` +
        `Options:\n` +
        `  • Reply /reject_${userId} to notify the client to re-submit\n` +
        `  • Fix manually and retry /approve_${userId}`,
        { parse_mode: "HTML" }
      );

      // Notify user their credentials failed
      try {
        await ctx.api.sendMessage(
          userId,
          `╔═══════════════════════════╗\n` +
          `║  ❌  CREDENTIALS INVALID   ║\n` +
          `╚═══════════════════════════╝\n\n` +
          `Hi *${pending.fullName}*, our team attempted to connect to your MT4/MT5 account but the credentials could not be verified.\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `⚠️ *Possible causes:*\n\n` +
          `  • Wrong login/account number\n` +
          `  • Incorrect main or investor password\n` +
          `  • Wrong broker server name\n` +
          `  • Wrong platform (MT4 vs MT5)\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `Please re-submit with corrected details using /register`,
          {
            parse_mode: "Markdown",
            reply_markup: new InlineKeyboard()
              .text("📝 Re-submit Credentials", "menu_register").row()
              .text("🏠 Main Menu", "menu_main"),
          }
        );
      } catch (e) {
        console.error(`Could not notify user ${userId}:`, e);
      }
      return;
    }

    // ── Step 3b: Credentials valid — activate account ─────────────────────────
    const deposit = parseFloat(pending.depositAmount ?? "0");
    const startDate = pending.startDate ? new Date(pending.startDate) : new Date();
    const live = result.balance;

    registerAccount(
      userId,
      deposit,
      startDate,
      pending.fullName ?? "Trader",
      pending.platform,
      pending.brokerName,
      pending.accountNumber,
      pending.email,
      result.metaApiAccountId,
      pending.serverName
    );
    removePending(userId);

    // ── Notify the user ────────────────────────────────────────────────────────
    const balanceLine = live
      ? `💰 Live Balance: *${live.currency} ${formatUSD(live.balance)}*\n` +
        `📊 Equity:       *${live.currency} ${formatUSD(live.equity)}*\n`
      : `💰 Deposit: *$${pending.depositAmount}*\n`;

    try {
      await ctx.api.sendMessage(
        userId,
        `╔═══════════════════════════╗\n` +
        `║  ✅  ACCOUNT APPROVED!     ║\n` +
        `╚═══════════════════════════╝\n\n` +
        `🎉 Congratulations, *${pending.fullName}*!\n\n` +
        `Your MT4/MT5 account has been verified and *activated* by our team. Your live balance is now visible in the dashboard.\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📋 *Your Account*\n` +
        `   Platform:  *${pending.platform}*\n` +
        `   Broker:    *${pending.brokerName}*\n` +
        `   Server:    \`${pending.serverName}\`\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📈 *Live Data*\n` +
        balanceLine +
        `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Tap below to open your live balance dashboard. 📊`,
        {
          parse_mode: "Markdown",
          reply_markup: new InlineKeyboard()
            .text("📊 View Live Balance", "menu_balance").row()
            .text("💰 Deposit More", "menu_deposit"),
        }
      );
    } catch (e) {
      console.error(`Failed to notify user ${userId}:`, e);
      await ctx.reply(
        `⚠️ Account activated but <b>could not message user</b> <code>${userId}</code> — they may not have started the bot yet.`,
        { parse_mode: "HTML" }
      );
    }

    // ── Confirm in admin channel ───────────────────────────────────────────────
    const liveInfo = live
      ? `\n\n💰 <b>Live Broker Data</b>\n` +
        `   Balance:  <b>${live.currency} ${formatUSD(live.balance)}</b>\n` +
        `   Equity:   ${live.currency} ${formatUSD(live.equity)}\n` +
        `   Open P&L: ${live.openProfit >= 0 ? "+" : ""}${formatUSD(live.openProfit)}\n` +
        (live.leverage ? `   Leverage: 1:${live.leverage}` : "")
      : "";

    await ctx.reply(
      `✅ <b>Account Activated &amp; Verified</b>\n\n` +
      `👤 <b>${pending.fullName ?? "Trader"}</b>\n` +
      `🆔 User ID: <code>${userId}</code>\n` +
      `💵 Deposit: <b>$${pending.depositAmount}</b>\n` +
      `📅 Start: ${pending.startDate}\n` +
      `🖥 ${pending.platform} — ${pending.brokerName}` +
      liveInfo +
      `\n\n🔗 MetaAPI ID: <code>${result.metaApiAccountId}</code>\n\n` +
      `User has been notified. Dashboard is now live with real broker data.`,
      { parse_mode: "HTML" }
    );
  });
}
