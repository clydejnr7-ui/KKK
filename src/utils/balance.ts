export interface AccountData {
  deposit: number;
  startDate: Date;
  fullName: string;
  platform?: string;
  broker?: string;
  accountNumber?: string;
  email?: string;
  metaApiAccountId?: string; // set after admin approves + MetaAPI connects
  serverName?: string;
}

// Mirrors the shape returned by MetaAPI (also used in metaapi.ts)
export interface LiveBalance {
  balance: number;
  equity: number;
  openProfit: number;
  currency: string;
  leverage?: number;
  lastUpdated: Date;
  server?: string;
}

export function computeBalance(principal: number, daysElapsed: number): number {
  return principal * Math.pow(1.03, daysElapsed);
}

export function progressBar(percent: number, total = 18): string {
  const capped = Math.min(Math.max(percent, 0), 100);
  const filled = Math.round((capped / 100) * total);
  const empty = total - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

export function formatUSD(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function healthDots(score: number): string {
  const filled = Math.min(5, Math.ceil(score / 20));
  return "🟢".repeat(filled) + "⚫".repeat(5 - filled);
}

// ─── Tab 1: Overview ─────────────────────────────────────────────────────────
export function buildOverviewTab(data: AccountData, live?: LiveBalance): string {
  const now = new Date();
  const msPerDay = 86_400_000;
  const daysElapsed = Math.max(0, Math.floor((now.getTime() - data.startDate.getTime()) / msPerDay));

  // Use real broker data if available, otherwise fall back to compound estimate
  const currentBalance = live ? live.balance : computeBalance(data.deposit, daysElapsed);
  const totalProfit = currentBalance - data.deposit;
  const growthPct = data.deposit > 0 ? ((currentBalance - data.deposit) / data.deposit) * 100 : 0;

  const nextMilestone = Math.ceil(currentBalance / 1000) * 1000;
  const daysToMilestone = Math.max(1,
    Math.ceil(Math.log(nextMilestone / data.deposit) / Math.log(1.03)) - daysElapsed
  );
  const healthScore = Math.min(100, 50 + daysElapsed * 2);
  const growthBar = progressBar(Math.min(growthPct, 100));

  // ── Middle section: real broker data OR compound estimate ────────────────
  const msElapsed = now.getTime() - data.startDate.getTime();
  const hoursElapsed = msElapsed / 3_600_000;
  const isFirstDay = daysElapsed === 0;

  let middleSection: string;

  if (live) {
    // ── LIVE data from MetaAPI ──────────────────────────────────────────────
    const updatedAgo = Math.round((Date.now() - live.lastUpdated.getTime()) / 1000);
    const agoStr = updatedAgo < 60
      ? `${updatedAgo}s ago`
      : `${Math.round(updatedAgo / 60)}m ago`;
    const openSign = live.openProfit >= 0 ? "+" : "";
    const equityBar = progressBar(Math.min(Math.abs(live.openProfit / (live.balance || 1)) * 1000, 100));

    middleSection =
      `⚡ *LIVE BROKER DATA*\n` +
      `  💵 Balance:    *${live.currency} ${formatUSD(live.balance)}*\n` +
      `  📊 Equity:     *${live.currency} ${formatUSD(live.equity)}*\n` +
      `  📉 Open P&L:   *${openSign}${formatUSD(live.openProfit)}*\n` +
      (live.leverage ? `  ⚙️ Leverage:   1:${live.leverage}\n` : ``) +
      `  ${equityBar}\n` +
      `  🕐 Updated ${agoStr} · 🟢 Connected\n`;
  } else if (isFirstDay) {
    // ── First-day countdown ────────────────────────────────────────────────
    const hoursLeft = Math.max(0, 24 - hoursElapsed);
    const hh = Math.floor(hoursLeft);
    const mm = Math.floor((hoursLeft - hh) * 60);
    const waitBar = progressBar(Math.min((hoursElapsed / 24) * 100, 100));
    const firstDayProfit = data.deposit * 0.03;
    middleSection =
      `⏳ *FIRST EARNINGS COUNTDOWN*\n` +
      `${waitBar}  ${Math.floor((hoursElapsed / 24) * 100)}%\n` +
      `  ⏱ Starts in: *${hh}h ${mm}m*\n` +
      `  💵 First payout: *${formatUSD(firstDayProfit)}*\n` +
      `  📅 Daily rate: +3.00% compounding\n`;
  } else {
    // ── Compound estimate (no MetaAPI) ─────────────────────────────────────
    const msIntoCurrentDay = msElapsed - daysElapsed * 86_400_000;
    const dayFraction = msIntoCurrentDay / 86_400_000;
    const fullDayProfit = computeBalance(data.deposit, daysElapsed) * 0.03;
    const earnedToday = fullDayProfit * dayFraction;
    const remaining = fullDayProfit - earnedToday;
    const dayBar = progressBar(dayFraction * 100);
    middleSection =
      `⚡ *TODAY'S EARNINGS*\n` +
      `${dayBar}  ${(dayFraction * 100).toFixed(0)}%\n` +
      `  ✅ Earned:      *${formatUSD(earnedToday)}*\n` +
      `  ⏳ Remaining:  ${formatUSD(remaining)}\n` +
      `  📦 Day total:   ${formatUSD(fullDayProfit)}\n`;
  }

  // Status indicator
  const statusLine = live
    ? `🟢 Live · ${data.platform ?? ""} · ${data.broker ?? ""}`
    : `⚪ Estimated · +3%/day compound`;

  return (
    `╔═══════════════════════════╗\n` +
    `║  📊  TRADING FLUX  •  LIVE  ║\n` +
    `╚═══════════════════════════╝\n\n` +
    `👤 *${data.fullName}*\n` +
    `🗓 Since ${data.startDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}  •  Day *${daysElapsed}*\n\n` +
    `┌─────────────────────────┐\n` +
    `│  💰 CURRENT BALANCE      │\n` +
    `│  *${formatUSD(currentBalance).padEnd(24)}*│\n` +
    `└─────────────────────────┘\n\n` +
    `📥 Deposit       ${formatUSD(data.deposit)}\n` +
    `📈 Net Profit    *${totalProfit >= 0 ? "+" : ""}${formatUSD(totalProfit)}*\n` +
    `🚀 Growth        *${growthPct >= 0 ? "+" : ""}${growthPct.toFixed(2)}%*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    middleSection +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📉 *OVERALL GROWTH*\n` +
    `${growthBar}  ${Math.min(Math.abs(growthPct), 100).toFixed(1)}%\n\n` +
    `🎯 Next milestone: *${formatUSD(nextMilestone)}*\n` +
    `🛡 Health: ${healthDots(healthScore)}  ${healthScore}%\n` +
    `${statusLine}`
  );
}

// ─── Tab 2: Projections ───────────────────────────────────────────────────────
export function buildProjectionsTab(data: AccountData): string {
  const now = new Date();
  const msPerDay = 86_400_000;
  const daysElapsed = Math.max(0, Math.floor((now.getTime() - data.startDate.getTime()) / msPerDay));
  const current = computeBalance(data.deposit, daysElapsed);

  function bal(d: number) { return formatUSD(computeBalance(data.deposit, d)); }
  function bar(d: number) {
    const pct = ((computeBalance(data.deposit, d) / data.deposit) - 1) * 100;
    return progressBar(Math.min(pct, 200) / 2, 10);
  }
  function tag(d: number) { return daysElapsed >= d ? "✅" : "🔜"; }

  return (
    `╔═══════════════════════════╗\n` +
    `║  📈  GROWTH PROJECTIONS   ║\n` +
    `╚═══════════════════════════╝\n\n` +
    `💰 Deposit: *${formatUSD(data.deposit)}*\n` +
    `📊 Current: *${formatUSD(current)}*  (Day ${daysElapsed})\n` +
    `📅 Rate: *+3.00% / day compounding*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📅 *MILESTONES*\n\n` +
    `${tag(7)}  Day 7    ${bar(7)} ${bal(7)}\n` +
    `${tag(14)} Day 14   ${bar(14)} ${bal(14)}\n` +
    `${tag(30)} Day 30   ${bar(30)} ${bal(30)}\n` +
    `${tag(60)} Day 60   ${bar(60)} ${bal(60)}\n` +
    `${tag(90)} Day 90   ${bar(90)} ${bal(90)}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🌟 *LONG-TERM OUTLOOK*\n\n` +
    `  6 months:   *${bal(180)}*\n` +
    `  12 months:  *${bal(365)}*\n` +
    `  18 months:  *${bal(547)}*\n` +
    `  24 months:  *${bal(730)}*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `_Formula: Balance = ${formatUSD(data.deposit)} × 1.03^days_`
  );
}

// ─── Tab 3: Daily Log ─────────────────────────────────────────────────────────
export function buildDailyLogTab(data: AccountData): string {
  const now = new Date();
  const msPerDay = 86_400_000;
  const daysElapsed = Math.max(0, Math.floor((now.getTime() - data.startDate.getTime()) / msPerDay));

  const rows: string[] = [];
  const showDays = Math.min(daysElapsed, 7);

  for (let i = showDays; i >= 1; i--) {
    const day = daysElapsed - i + 1;
    const balStart = computeBalance(data.deposit, day - 1);
    const profit = balStart * 0.03;
    const date = new Date(data.startDate.getTime() + (day - 1) * msPerDay);
    const label = date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    rows.push(`  ${label}  Day ${day}   +${formatUSD(profit)}`);
  }

  const todayBalance = computeBalance(data.deposit, daysElapsed);
  const todayProfit = todayBalance * 0.03;
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  const dayFraction = minuteOfDay / 1440;

  return (
    `╔═══════════════════════════╗\n` +
    `║  📅  DAILY EARNINGS LOG   ║\n` +
    `╚═══════════════════════════╝\n\n` +
    `👤 *${data.fullName}*\n` +
    `📊 Account active for *${daysElapsed} days*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚡ *TODAY  (In Progress)*\n` +
    `  ${progressBar(dayFraction * 100, 18)}\n` +
    `  Earned: *${formatUSD(todayProfit * dayFraction)}* of ${formatUSD(todayProfit)}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📋 *LAST ${showDays} DAYS*\n\n` +
    (rows.length > 0
      ? rows.join("\n")
      : `  _No completed days yet. Check back tomorrow!_`) +
    `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 Total earned to date:\n` +
    `   *${formatUSD(todayBalance - data.deposit)}*\n\n` +
    `🔁 Profits compound automatically every 24h`
  );
}

// ─── Tab 4: Account Info ──────────────────────────────────────────────────────
export function buildAccountTab(data: AccountData, isDemo: boolean): string {
  const statusLine = isDemo
    ? `🟡 *Demo Preview* — Not yet activated`
    : `🟢 *Active* — Managed by Trading Flux`;

  return (
    `╔═══════════════════════════╗\n` +
    `║  ℹ️   ACCOUNT DETAILS      ║\n` +
    `╚═══════════════════════════╝\n\n` +
    `👤 *Client*\n` +
    `   Name:    *${data.fullName}*\n` +
    (data.email ? `   Email:   \`${data.email}\`\n` : ``) +
    `\n` +
    `🖥️ *Trading Account*\n` +
    `   Platform: *${data.platform ?? "—"}*\n` +
    `   Broker:   *${data.broker ?? "—"}*\n` +
    `   Account:  \`${data.accountNumber ?? "—"}\`\n\n` +
    `💵 *Investment*\n` +
    `   Deposit:  *${formatUSD(data.deposit)}*\n` +
    `   Since:    ${data.startDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}\n` +
    `   Rate:     *+3.00% / day*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📌 *Status*\n` +
    `   ${statusLine}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🔒 *Security*\n` +
    `   ✅ Investor-only access\n` +
    `   ✅ No withdrawal permissions\n` +
    `   ✅ Funds stay in your account\n` +
    `   ✅ Cancel anytime\n\n` +
    `💬 Contact support to update details.`
  );
}
