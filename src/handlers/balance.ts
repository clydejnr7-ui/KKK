import { Bot, Context, InlineKeyboard } from "grammy";
import { Redis } from "@upstash/redis";
import {
  AccountData,
  LiveBalance,
  buildOverviewTab,
  buildProjectionsTab,
  buildDailyLogTab,
  buildAccountTab,
} from "../utils/balance";
import { isPending } from "../pending";
import { getFeeBalance } from "./deposit";

function r(): Redis {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

// ── Account read/write ─────────────────────────────────────────────────────────

async function getAccount(userId: number): Promise<{ data: AccountData; isDemo: boolean } | null> {
  const raw = await r().get<AccountData>(`acct:${userId}`);
  if (!raw) return null;

  const data: AccountData = {
    ...raw,
    startDate: new Date(raw.startDate as unknown as string),
    // Convert adjustedDate from Redis string to Date so display logic is consistent
    adjustedDate: raw.adjustedDate
      ? new Date(raw.adjustedDate as unknown as string)
      : undefined,
  };

  return { data, isDemo: false };
}

export async function registerAccount(
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
): Promise<void> {
  await r().set(`acct:${userId}`, {
    deposit,
    startDate: startDate.toISOString(),
    fullName,
    platform,
    broker,
    accountNumber,
    email,
    metaApiAccountId,
    serverName,
  });
  await r().sadd("active_accounts", userId);
}

export async function revokeAccount(userId: number): Promise<AccountData | null> {
  const raw = await r().get<AccountData>(`acct:${userId}`);
  if (!raw) return null;
  await r().del(`acct:${userId}`);
  await r().srem("active_accounts", userId);
  return {
    ...raw,
    startDate: new Date(raw.startDate as unknown as string),
    adjustedDate: raw.adjustedDate
      ? new Date(raw.adjustedDate as unknown as string)
      : undefined,
  };
}

export async function getAllActiveUserIds(): Promise<number[]> {
  const members = await r().smembers<number[]>("active_accounts");
  return members.map((m) => Number(m));
}

// ── Keyboards ──────────────────────────────────────────────────────────────────

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
  kb.text("💰 Top Up Fee Wallet", "menu_fee_topup").row();
  kb.text("🔄 Refresh", "dash_refresh").text("🏠 Main Menu", "menu_main");
  return kb;
}

// ── Fallback screens ───────────────────────────────────────────────────────────

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
  const keyboard = new InlineKeyboard().text("🏠 Main Menu", "menu_main");
  const opts = { parse_mode: "Markdown" as const, reply_markup: keyboard };
  if (edit) { try { await ctx.editMessageText(text, opts); return; } catch { } }
  await ctx.reply(text, opts);
}

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
  if (edit) { try { await ctx.editMessageText(text, opts); return; } catch { } }
  await ctx.reply(text, opts);
}

// ── Dashboard renderer ─────────────────────────────────────────────────────────

async function sendDashboard(
  ctx: Context,
  tab: "overview" | "projections" | "daily" | "account",
  edit = false
) {
  const account = await getAccount(ctx.from!.id);

  if (!account) {
    if (await isPending(ctx.from!.id)) {
      await sendPendingReview(ctx, edit);
    } else {
      await sendNotRegistered(ctx, edit);
    }
    return;
  }

  const { data, isDemo } = account;
  const live: LiveBalance | undefined = undefined;

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
    case "account": {
      const feeBal = await getFeeBalance(ctx.from!.id);
      text = buildAccountTab(data, isDemo, feeBal);
      keyboard = accountKeyboard(isDemo);
      break;
    }
    default:
      text = buildOverviewTab(data, live);
      keyboard = overviewKeyboard();
  }

  const opts = { parse_mode: "Markdown" as const, reply_markup: keyboard };
  if (edit) { try { await ctx.editMessageText(text, opts); return; } catch { } }
  await ctx.reply(text, opts);
}

// ── Register handlers ──────────────────────────────────────────────────────────

export function registerBalanceHandler(bot: Bot<Context>): void {
  bot.command("balance", async (ctx) => { await sendDashboard(ctx, "overview"); });
  bot.callbackQuery("menu_balance", async (ctx) => { await ctx.answerCallbackQuery(); await sendDashboard(ctx, "overview"); });
  bot.callbackQuery("dash_overview", async (ctx) => { await ctx.answerCallbackQuery(); await sendDashboard(ctx, "overview", true); });
  bot.callbackQuery("dash_projections", async (ctx) => { await ctx.answerCallbackQuery(); await sendDashboard(ctx, "projections", true); });
  bot.callbackQuery("dash_daily", async (ctx) => { await ctx.answerCallbackQuery(); await sendDashboard(ctx, "daily", true); });
  bot.callbackQuery("dash_account", async (ctx) => { await ctx.answerCallbackQuery(); await sendDashboard(ctx, "account", true); });
  bot.callbackQuery("dash_refresh", async (ctx) => { await ctx.answerCallbackQuery({ text: "🔄 Refreshed!" }); await sendDashboard(ctx, "overview", true); });
}
