import { Bot, Context, InlineKeyboard } from "grammy";
import { getPending, removePending } from "../pending";
import { registerAccount } from "./balance";
import { connectAndValidate } from "../utils/metaapi";
import { formatUSD } from "../utils/balance";

export function registerApproveHandler(bot: Bot<Context>): void {

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
    } catch (e) {
      console.error(`Failed to notify user ${userId}:`, e);
    }

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

  bot.callbackQuery(/^reject_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery("Rejected");
    const userId = parseInt(ctx.match[1], 10);
    const pending = await getPending(userId);

    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard().text("❌ Rejected", "noop"),
    });

    if (!pending) {
      await ctx.reply(`⚠️ No pending submission for <code>${userId}</code>.`, { parse_mode: "HTML" });
      return;
    }

    await removePending(userId);

    try {
      await ctx.api.sendMessage(userId,
        `╔═══════════════════════════╗\n║  ❌  APPLICATION REJECTED  ║\n╚═══════════════════════════╝\n\n` +
        `Hi *${pending.fullName}*, unfortunately your account submission could not be approved at this time.\n\n` +
        `Please contact support or re-submit with correct details.`,
        { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("📝 Re-submit", "menu_register").row().text("💬 Support", "menu_support") }
      );
    } catch (e) { console.error(`Could not notify user ${userId}:`, e); }

    await ctx.reply(
      `❌ <b>Submission Rejected</b>\n\n👤 <b>${pending.fullName}</b>\n🆔 <code>${userId}</code>\n\nUser has been notified.`,
      { parse_mode: "HTML" }
    );
  });

  bot.callbackQuery("noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });
}
