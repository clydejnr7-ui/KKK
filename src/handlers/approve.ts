import { Bot, Context, InlineKeyboard, NextFunction } from "grammy";
import { Redis } from "@upstash/redis";
import { getPending, removePending } from "../pending";
import { registerAccount, revokeAccount, getAllActiveUserIds } from "./balance";
import { connectAndValidate } from "../utils/metaapi";
import { formatUSD } from "../utils/balance";

function r(): Redis {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

function isAdminChannel(ctx: Context): boolean {
  const adminChannelId = process.env.ADMIN_CHANNEL_ID;
  return !!adminChannelId && ctx.chat?.id.toString() === adminChannelId;
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
          .text("✅ Approve", `approve_${userId}`)
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
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text("🔁 Retry Verify", `approve_${userId}`).row()
            .text("✅ Manual Override", `manual_${userId}`)
            .text("❌ Reject", `reject_${userId}`),
        }
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

    // ── Keep a Revoke button visible so admin can reject even after approval
    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard()
        .text("✅ Approved", "noop")
        .text("🔑 Revoke Account", `revoke_${userId}`),
    });

    try {
      await ctx.api.sendMessage(userId,
        `╔═══════════════════════════╗\n║  ✅  ACCOUNT APPROVED!     ║\n╚═══════════════════════════╝\n\n` +
        `🎉 Congratulations, *${pending.fullName}*!\n\nYour MT4/MT5 account has been verified and *activated*.\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n📋 *Your Account*\n   Platform: *${pending.platform}*\n   Broker: *${pending.brokerName}*\n   Server: \`${pending.serverName}\`\n\n` +
        `💰 Deposit: *$${pending.depositAmount}*\n\nOur team will manage your account from here. You will receive regular updates. 📊`,
        { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("💰 Deposit More", "menu_deposit").row().text("🏠 Main Menu", "menu_main") }
      );
    } catch (e) { console.error(`Failed to notify user ${userId}:`, e); }

    await ctx.reply(
      `✅ <b>Account Activated &amp; Verified</b>\n\n` +
      `👤 <b>${pending.fullName ?? "Trader"}</b>\n` +
      `🆔 User ID: <code>${userId}</code>\n` +
      `💵 Deposit: <b>$${pending.depositAmount}</b>\n` +
      `📅 Start: ${pending.startDate}\n` +
      `🖥 ${pending.platform} — ${pending.brokerName}\n\n` +
      `User has been notified.`,
      { parse_mode: "HTML" }
    );
  });

  // ── ✅ Manual Override ────────────────────────────────────────────────────
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

    // ── Keep a Revoke button visible so admin can reject even after approval
    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard()
        .text("✅ Manually Approved", "noop")
        .text("🔑 Revoke Account", `revoke_${userId}`),
    });

    try {
      await ctx.api.sendMessage(userId,
        `╔═══════════════════════════╗\n║  ✅  ACCOUNT APPROVED!     ║\n╚═══════════════════════════╝\n\n` +
        `🎉 Congratulations, *${pending.fullName}*!\n\nYour account has been manually reviewed and *activated* by our team.\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n📋 *Your Account*\n   Platform: *${pending.platform}*\n   Broker: *${pending.brokerName}*\n   Server: \`${pending.serverName}\`\n\n` +
        `💰 Deposit: *$${pending.depositAmount}*\n\nOur team will manage your account from here. You will receive regular updates. 📊`,
        { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("💰 Deposit More", "menu_deposit").row().text("🏠 Main Menu", "menu_main") }
      );
    } catch (e) { console.error(`Failed to notify user ${userId}:`, e); }

    await ctx.reply(
      `✅ <b>Manually Approved</b> (MetaAPI verification bypassed)\n\n` +
      `👤 <b>${pending.fullName}</b>\n` +
      `🆔 <code>${userId}</code>\n` +
      `💵 $${pending.depositAmount} — ${pending.platform} ${pending.brokerName}\n\n` +
      `User has been notified.`,
      { parse_mode: "HTML" }
    );
  });

  // ── ❌ Reject pending submission ──────────────────────────────────────────
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

  // ── 🔑 Revoke approved account ────────────────────────────────────────────
  bot.callbackQuery(/^revoke_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery("🔑 Revoking account...");
    const userId = parseInt(ctx.match[1], 10);

    const adminChatId = ctx.chat!.id.toString();
    await r().set(`revoke_reason:${adminChatId}`, userId, { ex: 300 });

    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard()
        .text("✅ Approved", "noop")
        .text("⏳ Awaiting reason...", "noop"),
    });

    const raw = await r().get<any>(`acct:${userId}`);

    await ctx.reply(
      `✍️ <b>Revocation Reason</b>\n\n` +
      `You are revoking the account of:\n` +
      `👤 <b>${raw?.fullName ?? "Unknown"}</b> (ID: <code>${userId}</code>)\n` +
      `🖥 ${raw?.platform ?? "—"} — ${raw?.broker ?? "—"}\n\n` +
      `Please type the <b>reason</b> to send to the user.\n\n` +
      `<i>You have 5 minutes. Send /cancel_revoke to abort.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // ── 🔍 /verifyaccounts ────────────────────────────────────────────────────
  bot.command("verifyaccounts", async (ctx) => {
    if (!isAdminChannel(ctx)) return;

    const userIds = await getAllActiveUserIds();

    if (userIds.length === 0) {
      await ctx.reply(`ℹ️ <b>No active accounts found.</b>`, { parse_mode: "HTML" });
      return;
    }

    await ctx.reply(
      `🔍 <b>Verifying ${userIds.length} active account${userIds.length !== 1 ? "s" : ""}...</b>\n\n⏳ Please wait...`,
      { parse_mode: "HTML" }
    );

    let passed = 0, failed = 0, skipped = 0;

    for (const userId of userIds) {
      const raw = await r().get<any>(`acct:${userId}`);
      if (!raw) {
        await r().srem("active_accounts", userId);
        skipped++;
        continue;
      }

      if (!raw.accountNumber || !raw.serverName || !raw.platform) {
        skipped++;
        await ctx.reply(
          `⚠️ <b>Skipped</b> user <code>${userId}</code> — missing credentials.\nUse /revokeaccount ${userId} to manually revoke if needed.`,
          { parse_mode: "HTML" }
        );
        continue;
      }

      if (!raw.investorPassword && !raw.password) {
        skipped++;
        continue;
      }

      const result = await connectAndValidate({
        userId,
        accountNumber: raw.accountNumber,
        password: raw.password ?? raw.investorPassword ?? "",
        investorPassword: raw.investorPassword,
        serverName: raw.serverName,
        platform: raw.platform as "MT4" | "MT5",
      });

      if (result.success) {
        passed++;
      } else {
        failed++;
        const isPasswordError =
          result.error?.toLowerCase().includes("invalid credentials") ||
          result.error?.toLowerCase().includes("invalid login") ||
          result.error?.toLowerCase().includes("wrong password") ||
          result.error?.toLowerCase().includes("notauthenticated");

        await ctx.reply(
          `🔑 <b>${isPasswordError ? "Password Changed" : "Verification Failed"}</b>\n\n` +
          `👤 <b>${raw.fullName ?? "Unknown"}</b>\n` +
          `🆔 <code>${userId}</code>\n` +
          `🖥 ${raw.platform} — ${raw.brokerName ?? raw.broker ?? "—"}\n` +
          `🏦 Server: <code>${raw.serverName}</code>\n` +
          `🔑 Login: <code>${raw.accountNumber}</code>\n\n` +
          `<b>Error:</b> ${result.error}\n\n` +
          `${isPasswordError ? "⚠️ User appears to have changed their MT4/MT5 password." : "⚠️ Connection failed — credentials may have changed or broker is unreachable."}`,
          {
            parse_mode: "HTML",
            reply_markup: new InlineKeyboard()
              .text("🔑 Revoke — Password Changed", `revoke_${userId}`).row()
              .text("🔁 Skip for Now", "noop"),
          }
        );
      }
    }

    await ctx.reply(
      `✅ <b>Verification Complete</b>\n\n` +
      `  ✅ Passed:  ${passed}\n` +
      `  ❌ Failed:  ${failed}\n` +
      `  ⏭ Skipped: ${skipped}\n\n` +
      `${failed > 0 ? "⚠️ Revoke flagged accounts above." : "All accounts verified successfully."}`,
      { parse_mode: "HTML" }
    );
  });

  // ── 🔑 /revokeaccount <userId> ────────────────────────────────────────────
  bot.command("revokeaccount", async (ctx) => {
    if (!isAdminChannel(ctx)) return;

    const parts = ctx.message?.text?.trim().split(/\s+/);
    const targetId = parts && parts[1] ? parseInt(parts[1], 10) : NaN;

    if (isNaN(targetId)) {
      await ctx.reply(
        `⚠️ <b>Usage:</b> <code>/revokeaccount &lt;userId&gt;</code>\n\nExample: <code>/revokeaccount 123456789</code>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const adminChatId = ctx.chat.id.toString();
    const raw = await r().get<any>(`acct:${targetId}`);
    if (!raw) {
      await ctx.reply(
        `⚠️ <b>No active account</b> found for user <code>${targetId}</code>.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    await r().set(`revoke_reason:${adminChatId}`, targetId, { ex: 300 });

    await ctx.reply(
      `✍️ <b>Manual Revocation</b>\n\n` +
      `You are revoking:\n` +
      `👤 <b>${raw.fullName ?? "Unknown"}</b> (ID: <code>${targetId}</code>)\n` +
      `🖥 ${raw.platform ?? "—"} — ${raw.broker ?? "—"}\n\n` +
      `Please type the <b>reason</b> to send to the user.\n\n` +
      `<i>You have 5 minutes. Send /cancel_revoke to abort.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // ── /cancel_revoke ────────────────────────────────────────────────────────
  bot.command("cancel_revoke", async (ctx) => {
    if (!isAdminChannel(ctx)) return;
    const adminChatId = ctx.chat.id.toString();
    const pending = await r().get(`revoke_reason:${adminChatId}`);
    if (!pending) { await ctx.reply(`ℹ️ No revocation in progress.`); return; }
    await r().del(`revoke_reason:${adminChatId}`);
    await ctx.reply(`✅ Revocation cancelled. The account remains active.`);
  });

  // ── /cancel_reject ────────────────────────────────────────────────────────
  bot.command("cancel_reject", async (ctx) => {
    const adminChannelId = process.env.ADMIN_CHANNEL_ID;
    if (ctx.chat.id.toString() !== adminChannelId) return;
    const adminChatId = ctx.chat.id.toString();
    const pending = await r().get(`reject_reason:${adminChatId}`);
    if (!pending) { await ctx.reply(`ℹ️ No rejection in progress.`); return; }
    await r().del(`reject_reason:${adminChatId}`);
    await ctx.reply(`✅ Rejection cancelled. The submission is still pending.`);
  });

  // ── Capture admin text (revocation reason OR rejection reason) ────────────
  bot.on("message:text", async (ctx, next: NextFunction) => {
    const adminChannelId = process.env.ADMIN_CHANNEL_ID;
    if (!adminChannelId || ctx.chat.id.toString() !== adminChannelId) {
      await next();
      return;
    }

    const text = ctx.message.text.trim();
    if (text.startsWith("/")) { await next(); return; }

    const adminChatId = ctx.chat.id.toString();

    // ── Revocation reason takes priority ──────────────────────────────────
    const revokeTargetId = await r().get<number>(`revoke_reason:${adminChatId}`);
    if (revokeTargetId) {
      await r().del(`revoke_reason:${adminChatId}`);
      const data = await revokeAccount(revokeTargetId);

      if (!data) {
        await ctx.reply(`⚠️ Account for user <code>${revokeTargetId}</code> no longer exists.`, { parse_mode: "HTML" });
        return;
      }

      try {
        await ctx.api.sendMessage(revokeTargetId,
          `╔═══════════════════════════╗\n║  🔑  ACCOUNT REVOKED       ║\n╚═══════════════════════════╝\n\n` +
          `Hi *${data.fullName}*,\n\n` +
          `Your account management has been *suspended* by our team.\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `📋 *Reason:*\n\n_${text}_\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `If you believe this is a mistake, please re-register or contact support.`,
          {
            parse_mode: "Markdown",
            reply_markup: new InlineKeyboard()
              .text("📝 Re-submit Account", "menu_register").row()
              .text("💬 Contact Support", "menu_support"),
          }
        );
      } catch (e) { console.error(`Failed to notify revoked user ${revokeTargetId}:`, e); }

      await ctx.reply(
        `🔑 <b>Account Revoked</b>\n\n` +
        `👤 <b>${data.fullName}</b>\n` +
        `🆔 <code>${revokeTargetId}</code>\n` +
        `🖥 ${data.platform ?? "—"} — ${data.broker ?? "—"}\n` +
        `💵 Deposit was: <b>${formatUSD(data.deposit)}</b>\n\n` +
        `📋 <b>Reason sent:</b>\n<i>${text}</i>\n\nUser has been notified.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // ── Rejection reason ──────────────────────────────────────────────────
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
      `📋 <b>Reason sent:</b>\n<i>${text}</i>\n\nUser has been notified.`,
      { parse_mode: "HTML" }
    );
  });

  // ── Noop ──────────────────────────────────────────────────────────────────
  bot.callbackQuery("noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });
}
