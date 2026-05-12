import { Bot, Context, InlineKeyboard } from "grammy";
import {
  AccountData,
  LiveBalance,
  buildOverviewTab,
  buildProjectionsTab,
  buildDailyLogTab,
  buildAccountTab,
} from "../utils/balance";
import { isPending } from "../pending";
import { fetchLiveBalance } from "../utils/metaapi";

// ─── Account store ────────────────────────────────────────────────────────────
const accounts: Record<number, AccountData> = {};

function getAccount(ctx: Context): { data: AccountData; isDemo: boolean } | null {
  const userId = ctx.from!.id;
  if (accounts[userId]) return { data: accounts[userId], isDemo: false };
  return null;
}

// ─── Dashboard keyboards ───────────────────────────────────────────────────────
function dashboardNavRow(): InlineKeyboard {
  return new InlineKeyboard()
    .text("💰 Deposit", "menu_deposit")
    .text("💳 Pay Fee ($3)", "menu_fee").row()
    .text("🔄 Refresh", "dash_refresh")
    .text("🏠 Main Menu", "menu_main");
}

function overviewKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📊 Overview ◀", "dash_overview")
    .text("📈 Projections", "dash_projections").row()
    .text("📅 Daily Log", "dash_daily")
    .text("ℹ️ Account", "dash_account").row()
    .text("💰 Deposit", "menu_deposit")
    .text("💳 Pay Fee ($3)", "menu_fee").row()
    .text("🔄 Refresh", "dash_refresh")
    .text("🏠 Main Menu", "menu_main");
}

function projectionsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📊 Overview", "dash_overview")
    .text("📈 Projections ◀", "dash_projections").row()
    .text("📅 Daily Log", "dash_daily")
    .text("ℹ️ Account", "dash_account").row()
    .text("💰 Deposit", "menu_deposit")
    .text("💳 Pay Fee ($3)", "menu_fee").row()
    .text("🔄 Refresh", "dash_refresh")
    .text("🏠 Main Menu", "menu_main");
}

function dailyKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📊 Overview", "dash_overview")
    .text("📈 Projections", "dash_projections").row()
    .text("📅 Daily Log ◀", "dash_daily")
    .text("ℹ️ Account", "dash_account").row()
    .text("💰 Deposit", "menu_deposit")
    .text("💳 Pay Fee ($3)", "menu_fee").row()
    .text("🔄 Refresh", "dash_refresh")
    .text("🏠 Main Menu", "menu_main");
}

function accountKeyboard(isDemo: boolean): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("📊 Overview", "dash_overview")
    .text("📈 Projections", "dash_projections").row()
    .text("📅 Daily Log", "dash_daily")
    .text("ℹ️ Account ◀", "dash_account").row();
  if (isDemo) {
    kb.text("📝 Register Now", "menu_register").row();
  }
  kb.text("💰 Deposit", "menu_deposit")
    .text("💳 Pay Fee ($3)", "menu_fee").row();
  kb.text("🔄 Refresh", "dash_refresh").text("🏠 Main Menu", "menu_main");
  return kb;
}

// ─── Pending-review prompt ─────────────────────────────────────────────────────
async function sendPendingReview(ctx: Context, edit = false) {
  const text =
    `╔═══════════════════════════╗\n` +
    `║  📊  TRADING FLUX  •  LIVE  ║\n` +
    `╚═══════════════════════════╝\n\n` +
    `🔎 *Account Under Review*\n\n` +
    `Your submission has been received and is being reviewed by our team.\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⏳ *What happens next?*\n\n` +
    `  1️⃣ Our team verifies your MT4/MT5 credentials\n` +
    `  2️⃣ You receive a notification once approved\n` +
    `  3️⃣ Your live balance dashboard activates instantly\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🕐 Review time: *up to 24 hours*\n` +
    `📩 You will be messaged here when approved.`;

  const keyboard = new InlineKeyboard()
    .text("🏠 Main Menu", "menu_main");

  const opts = { parse_mode: "Markdown" as const, reply_markup: keyboard };

  if (edit) {
    try { await ctx.editMessageText(text, opts); return; } catch { /* fall through */ }
  }
  await ctx.reply(text, opts);
}

// ─── Not-registered prompt ────────────────────────────────────────────────────
async function sendNotRegistered(ctx: Context, edit = false) {
  const text =
    `╔═══════════════════════════╗\n` +
    `║  📊  TRADING FLUX  •  LIVE  ║\n` +
    `╚═══════════════════════════╝\n\n` +
    `⚠️ *No account linked yet.*\n\n` +
    `You haven't submitted your MT4/MT5 credentials yet.\n\n` +
    `To see your real live balance:\n\n` +
    `  1️⃣ Tap *Register Account* below\n` +
    `  2️⃣ Complete the 9-step form\n` +
    `  3️⃣ Your balance activates once our team approves\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `Once approved, this dashboard will show:\n` +
    `  📈 Your real deposit growing at +3%/day\n` +
    `  📅 Daily earnings log\n` +
    `  🎯 Milestone projections\n` +
    `  ℹ️ Your account details`;

  const keyboard = new InlineKeyboard()
    .text("📝 Register Account", "menu_register").row()
    .text("🏠 Main Menu", "menu_main");

  const opts = { parse_mode: "Markdown" as const, reply_markup: keyboard };

  if (edit) {
    try { await ctx.editMessageText(text, opts); return; } catch { /* fall through */ }
  }
  await ctx.reply(text, opts);
}

// ─── Core render helper ────────────────────────────────────────────────────────
async function sendDashboard(ctx: Context, tab: "overview" | "projections" | "daily" | "account", edit = false) {
  const account = getAccount(ctx);

  if (!account) {
    if (isPending(ctx.from!.id)) {
      await sendPendingReview(ctx, edit);
    } else {
      await sendNotRegistered(ctx, edit);
    }
    return;
  }

  const { data, isDemo } = account;

  // ── Fetch live balance from MetaAPI if account is connected ───────────────
  let live: LiveBalance | undefined;
  if (data.metaApiAccountId) {
    const result = await fetchLiveBalance(data.metaApiAccountId, data.serverName);
    live = result ?? undefined;
  }

  let text: string;
  let keyboard: InlineKeyboard;

  switch (tab) {
    case "projections":
      text = buildProjectionsTab(data);
      keyboard = projectionsKeyboard();
      break;
    case "daily":
      text = buildDailyLogTab(data);
      keyboard = dailyKeyboard();
      break;
    case "account":
      text = buildAccountTab(data, isDemo);
      keyboard = accountKeyboard(isDemo);
      break;
    default:
      // Overview always gets the live balance overlay when available
      text = buildOverviewTab(data, live);
      keyboard = overviewKeyboard();
  }

  const opts = { parse_mode: "Markdown" as const, reply_markup: keyboard };

  if (edit) {
    try {
      await ctx.editMessageText(text, opts);
      return;
    } catch { /* fall through */ }
  }
  await ctx.reply(text, opts);
}

// ─── Register all balance handlers ────────────────────────────────────────────
export function registerBalanceHandler(bot: Bot<Context>): void {

  // /balance command
  bot.command("balance", async (ctx) => {
    await sendDashboard(ctx, "overview");
  });

  // Main menu button — opens dashboard directly
  bot.callbackQuery("menu_balance", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendDashboard(ctx, "overview");
  });

  // Tab navigation
  bot.callbackQuery("dash_overview", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendDashboard(ctx, "overview", true);
  });

  bot.callbackQuery("dash_projections", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendDashboard(ctx, "projections", true);
  });

  bot.callbackQuery("dash_daily", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendDashboard(ctx, "daily", true);
  });

  bot.callbackQuery("dash_account", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendDashboard(ctx, "account", true);
  });

  // Refresh — re-renders current overview with fresh numbers
  bot.callbackQuery("dash_refresh", async (ctx) => {
    await ctx.answerCallbackQuery("🔄 Refreshed!");
    await sendDashboard(ctx, "overview", true);
  });
}

// ─── Called after admin approves a submission ─────────────────────────────────
export function registerAccount(
  userId: number,
  deposit: number,
  startDate: Date,
  fullName: string,
  platform?: string,
  broker?: string,
  accountNumber?: string,
  email?: string,
  metaApiAccountId?: string,
  serverName?: string
): void {
  accounts[userId] = {
    deposit,
    startDate,
    fullName,
    platform,
    broker,
    accountNumber,
    email,
    metaApiAccountId,
    serverName,
  };
}
