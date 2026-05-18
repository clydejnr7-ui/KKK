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

function getCmdText(ctx: Context): string {
  return (ctx.message?.text ?? (ctx as any).channelPost?.text ?? "").trim();
}

async function handleAdminText(ctx: Context, next: NextFunction): Promise<void> {
  if (!isAdminChannel(ctx)) { await next(); return; }

  const text = getCmdText(ctx);
  if (!text || text.startsWith("/")) { await next(); return; }

  const adminChatId = ctx.chat!.id.toString();

  const revokeTargetRaw = await r().get(`revoke_reason:${adminChatId}`);
  if (revokeTargetRaw !== null) {
    const revokeTargetId = Number(revokeTargetRaw);
    await r().del(`revoke_reason:${adminChatId}`);
    const data = await revokeAccount(revokeTargetId);

    if (!data) {
      await ctx.api.sendMessage(
        ctx.chat!.id,
        `⚠️ Account for user <code>${revokeTargetId}</code> no longer exists — may already be revoked.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    try {
      await ctx.api.sendMessage(
        revokeTargetId,
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
    } catch (e) {
      console.error(`[revoke] Failed to notify user ${revokeTargetId}:`, e);
    }

    await ctx.api.sendMessage(
      ctx.chat!.id,
      `🔑 <b>Account Revoked</b>\n\n` +
      `👤 <b>${data.fullName}</b>\n` +
      `🆔 <code>${revokeTargetId}</code>\n` +
      `🖥 ${data.platform ?? "—"} — ${data.broker ?? "—"}\n` +
      `💵 Deposit was: <b>${formatUSD(data.deposit)}</b>\n\n` +
      `📋 <b>Reason sent to user:</b>\n<i>${text}</i>`,
      { parse_mode: "HTML" }
    );
    return;
  }

  const pendingUserRaw = await r().get(`reject_reason:${adminChatId}`);
  if (pendingUserRaw === null) { await next(); return; }

  const pendingUserId = Number(pendingUserRaw);
  await r().del(`reject_reason:${adminChatId}`);

  const pending = await getPending(pendingUserId);
  if (!pending) {
    await ctx.api.sendMessage(
      ctx.chat!.id,
      `⚠️ Submission for user <code>${pendingUserId}</code> no longer exists.`,
      { parse_mode: "HTML" }
    );
    return;
  }

  await removePending(pendingUserId);

  try {
    await ctx.api.sendMessage(
      pendingUserId,
      `╔═══════════════════════════╗\n║  ❌  APPLICATION REJECTED  ║\n╚═══════════════════════════╝\n\n` +
      `Hi *${pending.fullName}*, unfortunately your account submission has been reviewed and could not be approved.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n📋 *Reason from our team:*\n\n_${text}_\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Please correct the issue and re-submit, or contact support for help.`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("📝 Re-submit", "menu_register").row()
          .text("💬 Support", "menu_support"),
      }
    );
  } catch (e) {
    console.error(`[reject] Failed to notify user ${pendingUserId}:`, e);
  }

  await ctx.api.sendMessage(
    ctx.chat!.id,
    `❌ <b>Submission Rejected</b>\n\n` +
    `👤 <b>${pending.fullName}</b>\n` +
    `🆔 <code>${pendingUserId}</code>\n\n` +
    `📋 <b>Reason sent to user:</b>\n<i>${text}</i>`,
    { parse_mode: "HTML" }
  );
}

export function registerApproveHandler(bot: Bot<Context>): void {

  bot.on("message:text", handleAdminText);
  bot.on("channel_post:text", handleAdminText);

  // ── ✅ Approve ────────────────────────────────────────────────────────────
  bot.callbackQuery(/^approve_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery("⏳ Verifying...");
    const userId = parseInt(ctx.match[1], 10);
    const pending = await getPending(userId);

    if (!pending) {
      await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
      await ctx.reply(
        `⚠️ <b>No pending submission</b> found for user <code>${userId}</code>.`,
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
        `💰 Deposit: *$${pending.depositAmount}*\n\nOur team will manage your account from here. 📊`,
        { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("💰 Deposit More", "menu_deposit").row().text("🏠 Main Menu", "menu_main") }
      );
    } catch (e) { console.error(`[approve] Failed to notify user ${userId}:`, e); }

    await ctx.reply(
      `✅ <b>Account Activated &amp; Verified</b>\n\n` +
      `👤 <b>${pending.fullName ?? "Trader"}</b>\n` +
      `🆔 User ID: <code>${userId}</code>\n` +
      `💵 Deposit: <b>$${pending.depositAmount}</b>\n` +
      `📅 Start: ${pending.startDate}\n` +
      `🖥 ${pending.platform} — ${pending.brokerName}\n\nUser has been notified.`,
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
      undefined, pending.serverName
    );
    await removePending(userId);

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
        `💰 Deposit: *$${pending.depositAmount}*\n\nOur team will manage your account from here. 📊`,
        { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("💰 Deposit More", "menu_deposit").row().text("🏠 Main Menu", "menu_main") }
      );
    } catch (e) { console.error(`[manual] Failed to notify user ${userId}:`, e); }

    await ctx.reply(
      `✅ <b>Manually Approved</b> (MetaAPI verification bypassed)\n\n` +
      `👤 <b>${pending.fullName}</b>\n🆔 <code>${userId}</code>\n` +
      `💵 $${pending.depositAmount} — ${pending.platform} ${pending.brokerName}\n\nUser has been notified.`,
      { parse_mode: "HTML" }
    );
  });

  // ── ❌ Reject ─────────────────────────────────────────────────────────────
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

  // ── 🔑 Revoke (button clicked) ────────────────────────────────────────────
  bot.callbackQuery(/^revoke_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = parseInt(ctx.match[1], 10);
    const adminChatId = ctx.chat!.id.toString();

    await r().set(`revoke_reason:${adminChatId}`, userId, { ex: 300 });

    try {
      await ctx.editMessageReplyMarkup({
        reply_markup: new InlineKeyboard()
          .text("✅ Approved", "noop")
          .text("⏳ Awaiting reason...", "noop"),
      });
    } catch (_) {}

    const raw = await r().get<any>(`acct:${userId}`);

    await ctx.api.sendMessage(
      adminChatId,
      `✍️ <b>Revocation Reason</b>\n\n` +
      `You are revoking the account of:\n` +
      `👤 <b>${raw?.fullName ?? "Unknown"}</b> (ID: <code>${userId}</code>)\n` +
      `🖥 ${raw?.platform ?? "—"} — ${raw?.broker ?? raw?.brokerName ?? "—"}\n\n` +
      `Please type the <b>reason</b> to send to the user.\n\n` +
      `<i>You have 5 minutes. Send /cancel_revoke to abort.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // ── 📋 /listaccounts ──────────────────────────────────────────────────────
  bot.command("listaccounts", async (ctx) => {
    if (!isAdminChannel(ctx)) return;

    const chatId = ctx.chat!.id;
    const keys = await r().keys("acct:*");

    if (!keys || keys.length === 0) {
      await ctx.api.sendMessage(chatId,
        `╔═══════════════════════════╗\n║  📋  ACTIVE ACCOUNTS       ║\n╚═══════════════════════════╝\n\n` +
        `ℹ️ No approved accounts found.\n\n<i>Run /debugredis to inspect all Redis keys.</i>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    await ctx.api.sendMessage(chatId,
      `╔═══════════════════════════╗\n║  📋  ACTIVE ACCOUNTS       ║\n╚═══════════════════════════╝\n\n` +
      `<b>${keys.length} approved account${keys.length !== 1 ? "s" : ""}</b>\n\n` +
      `Each card below has a 🔑 Revoke button. Tap it, then type a reason.`,
      { parse_mode: "HTML" }
    );

    for (const key of keys) {
      try {
        const raw = await r().get<any>(key);
        if (!raw) continue;

        const userId = Number(key.replace("acct:", ""));
        await r().sadd("active_accounts", userId);

        const startDate = raw.startDate ? new Date(raw.startDate) : null;
        const daysActive = startDate
          ? Math.floor((Date.now() - startDate.getTime()) / 86_400_000)
          : "—";

        await ctx.api.sendMessage(
          chatId,
          `👤 <b>${raw.fullName ?? "Unknown"}</b>\n` +
          `🆔 <code>${userId}</code>\n` +
          `🖥 ${raw.platform ?? "—"} — ${raw.broker ?? raw.brokerName ?? "—"}\n` +
          `🏦 Server: <code>${raw.serverName ?? "—"}</code>\n` +
          `🔑 Login: <code>${raw.accountNumber ?? "—"}</code>\n` +
          `💵 Deposit: <b>${formatUSD(raw.deposit ?? 0)}</b>\n` +
          `📅 Active for: <b>${daysActive} day${daysActive === 1 ? "" : "s"}</b>`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[
                { text: "🔑 Revoke Account", callback_data: `revoke_${userId}` }
              ]]
            }
          }
        );
      } catch (e) {
        console.error(`[listaccounts] Error for key ${key}:`, e);
        await ctx.api.sendMessage(chatId, `⚠️ Error loading account <code>${key}</code>: ${e}`, { parse_mode: "HTML" });
      }
    }
  });

  // ── 🔧 /fixbutton <userId> ────────────────────────────────────────────────
  bot.command("fixbutton", async (ctx) => {
    if (!isAdminChannel(ctx)) return;

    const parts = getCmdText(ctx).split(/\s+/);
    const targetId = parts[1] ? parseInt(parts[1], 10) : NaN;

    if (isNaN(targetId)) {
      await ctx.api.sendMessage(ctx.chat!.id,
        `⚠️ <b>Usage:</b> <code>/fixbutton &lt;userId&gt;</code>\n\nExample: <code>/fixbutton 7764271121</code>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const raw = await r().get<any>(`acct:${targetId}`);
    if (!raw) {
      await ctx.api.sendMessage(ctx.chat!.id,
        `⚠️ No active account found for user <code>${targetId}</code>.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const startDate = raw.startDate ? new Date(raw.startDate) : null;
    const daysActive = startDate
      ? Math.floor((Date.now() - startDate.getTime()) / 86_400_000)
      : "—";

    await ctx.api.sendMessage(
      ctx.chat!.id,
      `✅ <b>Approved Account</b>\n\n` +
      `👤 <b>${raw.fullName ?? "Unknown"}</b>\n` +
      `🆔 <code>${targetId}</code>\n` +
      `🖥 ${raw.platform ?? "—"} — ${raw.broker ?? raw.brokerName ?? "—"}\n` +
      `🏦 Server: <code>${raw.serverName ?? "—"}</code>\n` +
      `🔑 Login: <code>${raw.accountNumber ?? "—"}</code>\n` +
      `💵 Deposit: <b>${formatUSD(raw.deposit ?? 0)}</b>\n` +
      `📅 Active for: <b>${daysActive} day${daysActive === 1 ? "" : "s"}</b>`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[
            { text: "🔑 Revoke Account", callback_data: `revoke_${targetId}` }
          ]]
        }
      }
    );
  });

  // ── 🔍 /verifyaccounts ────────────────────────────────────────────────────
  bot.command("verifyaccounts", async (ctx) => {
    if (!isAdminChannel(ctx)) return;

    const keys = await r().keys("acct:*");
    if (!keys || keys.length === 0) {
      await ctx.reply(`ℹ️ <b>No active accounts found.</b>`, { parse_mode: "HTML" });
      return;
    }

    await ctx.reply(
      `🔍 <b>Verifying ${keys.length} account${keys.length !== 1 ? "s" : ""}...</b>\n\n⏳ Please wait...`,
      { parse_mode: "HTML" }
    );

    let passed = 0, failed = 0, skipped = 0;

    for (const key of keys) {
      const raw = await r().get<any>(key);
      if (!raw) { skipped++; continue; }
      const userId = Number(key.replace("acct:", ""));
      await r().sadd("active_accounts", userId);

      if (!raw.accountNumber || !raw.serverName || !raw.platform || (!raw.investorPassword && !raw.password)) {
        skipped++; continue;
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
          `🖥 ${raw.platform} — ${raw.brokerName ?? raw.broker ?? "—"}\n\n` +
          `<b>Error:</b> ${result.error}`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🔑 Revoke Account", callback_data: `revoke_${userId}` }],
                [{ text: "🔁 Skip for Now", callback_data: "noop" }]
              ]
            }
          }
        );
      }
    }

    await ctx.reply(
      `✅ <b>Verification Complete</b>\n\n  ✅ Passed: ${passed}\n  ❌ Failed: ${failed}\n  ⏭ Skipped: ${skipped}\n\n` +
      `${failed > 0 ? "⚠️ Use /listaccounts to revoke flagged accounts." : "All accounts verified successfully."}`,
      { parse_mode: "HTML" }
    );
  });

  // ── 🔑 /revokeaccount <userId> ────────────────────────────────────────────
  bot.command("revokeaccount", async (ctx) => {
    if (!isAdminChannel(ctx)) return;

    const parts = getCmdText(ctx).split(/\s+/);
    const targetId = parts[1] ? parseInt(parts[1], 10) : NaN;

    if (isNaN(targetId)) {
      await ctx.api.sendMessage(ctx.chat!.id,
        `⚠️ <b>Usage:</b> <code>/revokeaccount &lt;userId&gt;</code>\n\nExample: <code>/revokeaccount 7764271121</code>\n\nTip: Use /listaccounts for button-based revocation.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const raw = await r().get<any>(`acct:${targetId}`);
    if (!raw) {
      await ctx.api.sendMessage(ctx.chat!.id,
        `⚠️ No active account found for user <code>${targetId}</code>.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const adminChatId = ctx.chat!.id.toString();
    await r().set(`revoke_reason:${adminChatId}`, targetId, { ex: 300 });

    await ctx.api.sendMessage(ctx.chat!.id,
      `✍️ <b>Manual Revocation</b>\n\n` +
      `You are revoking:\n👤 <b>${raw.fullName ?? "Unknown"}</b> (ID: <code>${targetId}</code>)\n` +
      `🖥 ${raw.platform ?? "—"} — ${raw.broker ?? raw.brokerName ?? "—"}\n\n` +
      `Please type the <b>reason</b> to send to the user.\n\n` +
      `<i>You have 5 minutes. Send /cancel_revoke to abort.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // ── /cancel_revoke ────────────────────────────────────────────────────────
  bot.command("cancel_revoke", async (ctx) => {
    if (!isAdminChannel(ctx)) return;
    const adminChatId = ctx.chat!.id.toString();
    const pending = await r().get(`revoke_reason:${adminChatId}`);
    if (!pending) { await ctx.api.sendMessage(ctx.chat!.id, `ℹ️ No revocation in progress.`); return; }
    await r().del(`revoke_reason:${adminChatId}`);
    await ctx.api.sendMessage(ctx.chat!.id, `✅ Revocation cancelled. The account remains active.`);
  });

  // ── /cancel_reject ────────────────────────────────────────────────────────
  bot.command("cancel_reject", async (ctx) => {
    if (!isAdminChannel(ctx)) return;
    const adminChatId = ctx.chat!.id.toString();
    const pending = await r().get(`reject_reason:${adminChatId}`);
    if (!pending) { await ctx.api.sendMessage(ctx.chat!.id, `ℹ️ No rejection in progress.`); return; }
    await r().del(`reject_reason:${adminChatId}`);
    await ctx.api.sendMessage(ctx.chat!.id, `✅ Rejection cancelled. The submission is still pending.`);
  });

  // ── 🔧 /testbutton ────────────────────────────────────────────────────────
  bot.command("testbutton", async (ctx) => {
    const chatId = ctx.chat!.id;
    const adminChannelId = process.env.ADMIN_CHANNEL_ID ?? "NOT SET";

    if (!isAdminChannel(ctx)) {
      await ctx.api.sendMessage(chatId,
        `❌ <b>isAdminChannel = FALSE</b>\n\nChat ID: <code>${chatId}</code>\nADMIN_CHANNEL_ID env: <code>${adminChannelId}</code>\n\nThese must match exactly.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    await ctx.api.sendMessage(chatId,
      `✅ <b>isAdminChannel = TRUE</b>\n\nChat ID: <code>${chatId}</code>\n\nSending button test...`,
      { parse_mode: "HTML" }
    );

    await ctx.api.sendMessage(chatId, `Tap below to confirm inline keyboards work:`, {
      reply_markup: {
        inline_keyboard: [[
          { text: "🔑 Test Revoke Button — tap me", callback_data: "noop" }
        ]]
      }
    });
  });

  // ── 🔧 /debugredis ────────────────────────────────────────────────────────
  bot.command("debugredis", async (ctx) => {
    if (!isAdminChannel(ctx)) return;
    const allKeys = await r().keys("*");
    if (!allKeys || allKeys.length === 0) {
      await ctx.api.sendMessage(ctx.chat!.id, `🔧 <b>Redis Debug</b>\n\nNo keys found.`, { parse_mode: "HTML" });
      return;
    }
    const chunks: string[] = [];
    let current = `🔧 <b>Redis Keys (${allKeys.length} total):</b>\n\n`;
    for (const key of allKeys) {
      const line = `• <code>${key}</code>\n`;
      if ((current + line).length > 3800) { chunks.push(current); current = ""; }
      current += line;
    }
    if (current) chunks.push(current);
    for (const chunk of chunks) await ctx.api.sendMessage(ctx.chat!.id, chunk, { parse_mode: "HTML" });
  });

  // ── 💰 /updateaccount <userId> <deposit> <YYYY-MM-DD> ────────────────────
  // Silent update — no message sent to user.
  // Updates deposit + start date in Redis. All figures recalculate
  // automatically next time the user opens /balance or Daily Log.
  //
  // Usage:  /updateaccount 123456789 5000 2026-05-01
  bot.command("updateaccount", async (ctx) => {
    if (!isAdminChannel(ctx)) return;

    const parts = getCmdText(ctx).split(/\s+/);
    const targetId = parseInt(parts[1] ?? "", 10);
    const newDeposit = parseFloat(parts[2] ?? "");
    const startDateStr = parts[3] ?? "";

    if (isNaN(targetId) || isNaN(newDeposit) || newDeposit <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(startDateStr)) {
      await ctx.api.sendMessage(ctx.chat!.id,
        `⚠️ <b>Usage:</b> <code>/updateaccount &lt;userId&gt; &lt;deposit&gt; &lt;YYYY-MM-DD&gt;</code>\n\n` +
        `<b>Example:</b> <code>/updateaccount 123456789 5000 2026-05-01</code>\n\n` +
        `Sets deposit to $5,000 from 2026-05-01. No message sent to user.\n` +
        `They see updated figures next time they open /balance.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const raw = await r().get<any>(`acct:${targetId}`);
    if (!raw) {
      await ctx.api.sendMessage(ctx.chat!.id,
        `⚠️ No active account found for user <code>${targetId}</code>.\n\nUse /listaccounts to check.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const startDate = new Date(`${startDateStr}T00:00:00.000Z`);
    const daysElapsed = Math.max(0, Math.floor((Date.now() - startDate.getTime()) / 86_400_000));
    const currentBalance = newDeposit * Math.pow(1.03, daysElapsed);
    const dailyEarning = currentBalance * 0.03;

    await r().set(`acct:${targetId}`, {
      ...raw,
      deposit: parseFloat(newDeposit.toFixed(2)),
      startDate: startDate.toISOString(),
    });

    await ctx.api.sendMessage(ctx.chat!.id,
      `✅ <b>Account Updated (Silent)</b>\n\n` +
      `👤 <b>${raw.fullName ?? "Unknown"}</b>\n` +
      `🆔 <code>${targetId}</code>\n\n` +
      `📥 Deposit:       <b>${formatUSD(newDeposit)}</b>\n` +
      `📅 Start Date:    <b>${startDateStr}</b>\n` +
      `📊 Day:           <b>${daysElapsed}</b>\n` +
      `💰 Balance Now:   <b>${formatUSD(currentBalance)}</b>\n` +
      `📈 Daily Earning: <b>+${formatUSD(dailyEarning)}</b>\n\n` +
      `<i>No message sent to user. New figures appear next time they open /balance or 📅 Daily Log.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // ── 💰 /setbalance <userId> <targetBalance> ───────────────────────────────
  // Silent update — no message sent to user.
  // Sets exactly what balance the user sees today by back-calculating
  // the deposit. Start date stays the same.
  //
  // Usage:  /setbalance 123456789 8500
  bot.command("setbalance", async (ctx) => {
    if (!isAdminChannel(ctx)) return;

    const parts = getCmdText(ctx).split(/\s+/);
    const targetId = parseInt(parts[1] ?? "", 10);
    const targetBalance = parseFloat(parts[2] ?? "");

    if (isNaN(targetId) || isNaN(targetBalance) || targetBalance <= 0) {
      await ctx.api.sendMessage(ctx.chat!.id,
        `⚠️ <b>Usage:</b> <code>/setbalance &lt;userId&gt; &lt;targetBalance&gt;</code>\n\n` +
        `<b>Example:</b> <code>/setbalance 123456789 8500</code>\n\n` +
        `Makes the user's balance show exactly $8,500 today.\n` +
        `Start date stays the same — deposit is back-calculated. No message sent to user.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const raw = await r().get<any>(`acct:${targetId}`);
    if (!raw) {
      await ctx.api.sendMessage(ctx.chat!.id,
        `⚠️ No active account found for user <code>${targetId}</code>.\n\nUse /listaccounts to check.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const startDate = new Date(raw.startDate as string);
    const daysElapsed = Math.max(0, Math.floor((Date.now() - startDate.getTime()) / 86_400_000));

    // balance = deposit × 1.03^days  →  deposit = balance / 1.03^days
    const newDeposit = daysElapsed > 0
      ? targetBalance / Math.pow(1.03, daysElapsed)
      : targetBalance;
    const dailyEarning = targetBalance * 0.03;

    await r().set(`acct:${targetId}`, {
      ...raw,
      deposit: parseFloat(newDeposit.toFixed(2)),
    });

    await ctx.api.sendMessage(ctx.chat!.id,
      `✅ <b>Balance Set (Silent)</b>\n\n` +
      `👤 <b>${raw.fullName ?? "Unknown"}</b>\n` +
      `🆔 <code>${targetId}</code>\n\n` +
      `💰 Balance Now:       <b>${formatUSD(targetBalance)}</b>\n` +
      `📈 Daily Earning:     <b>+${formatUSD(dailyEarning)}</b>\n` +
      `📅 Day:               <b>${daysElapsed}</b>\n` +
      `📥 Effective Deposit: <b>${formatUSD(newDeposit)}</b>\n\n` +
      `<i>No message sent to user. New figures appear next time they open /balance or 📅 Daily Log.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // ── Noop ──────────────────────────────────────────────────────────────────
  bot.callbackQuery("noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });
}
