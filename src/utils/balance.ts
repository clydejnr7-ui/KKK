export interface AccountData {
  deposit: number;
  startDate: Date;
  adjustedBalance?: number;
  adjustedDate?: Date;
  fullName: string;
  platform?: string;
  broker?: string;
  accountNumber?: string;
  email?: string;
  metaApiAccountId?: string;
  serverName?: string;
}

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

export function computeCurrentBalance(data: AccountData, now = new Date()): number {
  const msPerDay = 86_400_000;
  if (data.adjustedBalance != null && data.adjustedDate) {
    const adjDate = data.adjustedDate instanceof Date
      ? data.adjustedDate
      : new Date(data.adjustedDate as unknown as string);
    const daysSince = Math.max(0, Math.floor((now.getTime() - adjDate.getTime()) / msPerDay));
    return data.adjustedBalance * Math.pow(1.03, daysSince);
  }
  const daysElapsed = Math.max(0, Math.floor((now.getTime() - data.startDate.getTime()) / msPerDay));
  return computeBalance(data.deposit, daysElapsed);
}

export function getDayProfit(data: AccountData, dayNum: number): number {
  const msPerDay = 86_400_000;
  if (data.adjustedBalance != null && data.adjustedDate) {
    const adjDate = data.adjustedDate instanceof Date
      ? data.adjustedDate
      : new Date(data.adjustedDate as unknown as string);
    const adjDayNum = Math.max(0, Math.floor(
      (adjDate.getTime() - data.startDate.getTime()) / msPerDay
    ));
    if (dayNum > adjDayNum) {
      const daysSinceAdj = dayNum - adjDayNum - 1;
      const balStart = data.adjustedBalance * Math.pow(1.03, daysSinceAdj);
      return balStart * 0.03;
    }
  }
  const balStart = computeBalance(data.deposit, dayNum - 1);
  return balStart * 0.03;
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

export function buildOverviewTab(data: AccountData, live?: LiveBalance): string {
  const now = new Date();
  const msPerDay = 86_400_000;
  const daysElapsed = Math.max(0, Math.floor((now.getTime() - data.startDate.getTime()) / msPerDay));

  const currentBalance = live ? live.balance : computeCurrentBalance(data, now);
  const totalProfit = currentBalance - data.deposit;
  const growthPct = data.deposit > 0 ? ((currentBalance - data.deposit) / data.deposit) * 100 : 0;
  const nextMilestone = Math.ceil(currentBalance / 1000) * 1000;
  const healthScore = Math.min(100, 50 + daysElapsed * 2);
  const growthBar = progressBar(Math.min(growthPct, 100));
  const hoursElapsed = (now.getTime() - data.startDate.getTime()) / 3_600_000;
  const isFirstDay = daysElapsed === 0;
  const todayDailyEarning = currentBalance * 0.03;

  let middleSection: string;

  if (live) {
    const updatedAgo = Math.round((Date.now() - live.lastUpdated.getTime()) / 1000);
    const agoStr = updatedAgo < 60 ? `${updatedAgo}s ago` : `${Math.round(updatedAgo / 60)}m ago`;
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
    const hoursLeft = Math.max(0, 24 - hoursElapsed);
    const hh = Math.floor(hoursLeft);
    const mm = Math.floor((hoursLeft - hh) * 60);
    const waitBar = progressBar(Math.min((hoursElapsed / 24) * 100, 100));
    const firstDayProfit = (data.adjustedBalance ?? data.deposit) * 0.03;
    middleSection =
      `⏳ *FIRST EARNINGS COUNTDOWN*\n` +
      `${waitBar}  ${Math.floor((hoursElapsed / 24) * 100)}%\n` +
      `  ⏱ Starts in: *${hh}h ${mm}m*\n` +
      `  💵 First payout: *${formatUSD(firstDayProfit)}*\n` +
      `  📅 Daily rate: +3.00% compounding\n`;
  } else {
    const msElapsed = now.getTime() - data.startDate.getTime();
    const msIntoToday = msElapsed - daysElapsed * msPerDay;
    const dayFraction = Math.min(1, msIntoToday / msPerDay);
    const earnedToday = todayDailyEarning * dayFraction;
    const remaining = todayDailyEarning - earnedToday;
    const dayBar = progressBar(dayFraction * 100);
    middleSection =
      `⚡ *TODAY'S EARNINGS*\n` +
      `${dayBar}  ${(dayFraction * 100).toFixed(0)}%\n` +
      `  ✅ Earned so far: *${formatUSD(earnedToday)}*\n` +
      `  ⏳ Remaining:     ${formatUSD(remaining)}\n` +
      `  📦 Full day total: ${formatUSD(todayDailyEarning)}\n`;
  }

  const statusLine = live
    ? `🟢 Live · ${data.platform ?? ""} · ${data.broker ?? ""}`
    : `⚪ Estimated · +3%/day compound`;

  const updatedNote = (!live && data.adjustedBalance != null)
    ? `📌 Updated balance: _${formatUSD(data.adjustedBalance)}_\n`
    : ``;

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
    `📥 Original Deposit  ${formatUSD(data.deposit)}\n` +
    updatedNote +
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

export function buildProjectionsTab(data: AccountData): string {
  const now = new Date();
  const msPerDay = 86_400_000;
  const daysElapsed = Math.max(0, Math.floor((now.getTime() - data.startDate.getTime()) / msPerDay));
  const current = computeCurrentBalance(data, now);

  const adjDate = data.adjustedDate
    ? (data.adjustedDate instanceof Date ? data.adjustedDate : new Date(data.adjustedDate as unknown as string))
    : null;
  const adjDayNum = adjDate
    ? Math.max(0, Math.floor((adjDate.getTime() - data.startDate.getTime()) / msPerDay))
    : 0;
  const projBase = data.adjustedBalance ?? data.deposit;

  function projBalance(targetDay: number): string {
    if (data.adjustedBalance != null && adjDate) {
      const daysFromAdj = Math.max(0, targetDay - adjDayNum);
      return formatUSD(data.adjustedBalance * Math.pow(1.03, daysFromAdj));
    }
    return formatUSD(computeBalance(data.deposit, targetDay));
  }

  function bar(targetDay: number) {
    let val: number;
    if (data.adjustedBalance != null && adjDate) {
      const daysFromAdj = Math.max(0, targetDay - adjDayNum);
      val = data.adjustedBalance * Math.pow(1.03, daysFromAdj);
    } else {
      val = computeBalance(data.deposit, targetDay);
    }
    const pct = ((val / projBase) - 1) * 100;
    return progressBar(Math.min(pct, 200) / 2, 10);
  }

  function tag(d: number) { return daysElapsed >= d ? "✅" : "🔜"; }

  return (
    `╔═══════════════════════════╗\n` +
    `║  📈  GROWTH PROJECTIONS   ║\n` +
    `╚═══════════════════════════╝\n\n` +
    `📥 Original Deposit: *${formatUSD(data.deposit)}*\n` +
    (data.adjustedBalance != null ? `📌 Updated Balance:  *${formatUSD(data.adjustedBalance)}*\n` : ``) +
    `📊 Current: *${formatUSD(current)}*  (Day ${daysElapsed})\n` +
    `📅 Rate: *+3.00% / day compounding*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📅 *MILESTONES*\n\n` +
    `${tag(7)}  Day 7    ${bar(7)} ${projBalance(7)}\n` +
    `${tag(14)} Day 14   ${bar(14)} ${projBalance(14)}\n` +
    `${tag(30)} Day 30   ${bar(30)} ${projBalance(30)}\n` +
    `${tag(60)} Day 60   ${bar(60)} ${projBalance(60)}\n` +
    `${tag(90)} Day 90   ${bar(90)} ${projBalance(90)}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🌟 *LONG-TERM OUTLOOK*\n\n` +
    `  6 months:   *${projBalance(180)}*\n` +
    `  12 months:  *${projBalance(365)}*\n` +
    `  18 months:  *${projBalance(547)}*\n` +
    `  24 months:  *${projBalance(730)}*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `_Compounding from ${formatUSD(projBase)} at +3%/day_`
  );
}

export function buildDailyLogTab(data: AccountData): string {
  const now = new Date();
  const msPerDay = 86_400_000;
  const daysElapsed = Math.max(0, Math.floor((now.getTime() - data.startDate.getTime()) / msPerDay));

  const currentBalance = computeCurrentBalance(data, now);
  const todayDailyEarning = currentBalance * 0.03;

  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  const dayFraction = minuteOfDay / 1440;
  const earnedToday = todayDailyEarning * dayFraction;
  const remainingToday = todayDailyEarning - earnedToday;

  const rows: string[] = [];
  const showDays = Math.min(daysElapsed, 7);

  for (let i = showDays; i >= 1; i--) {
    const dayNum = daysElapsed - i + 1;
    const profit = getDayProfit(data, dayNum);
    const date = new Date(data.startDate.getTime() + (dayNum - 1) * msPerDay);
    const label = date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    rows.push(`  ${label}  Day ${String(dayNum).padEnd(3)}  +${formatUSD(profit)}`);
  }

  const totalEarned = currentBalance - data.deposit;

  const adjustedNote = data.adjustedBalance != null
    ? `\n📌 _Admin updated: ${formatUSD(data.adjustedBalance)}_`
    : ``;

  return (
    `╔═══════════════════════════╗\n` +
    `║  📅  DAILY EARNINGS LOG   ║\n` +
    `╚═══════════════════════════╝\n\n` +
    `👤 *${data.fullName}*\n` +
    `📥 Original Deposit: *${formatUSD(data.deposit)}*\n` +
    `💰 Current Balance:  *${formatUSD(currentBalance)}*\n` +
    `📊 Active for *${daysElapsed} day${daysElapsed === 1 ? "" : "s"}*${adjustedNote}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚡ *TODAY  (In Progress)*\n` +
    `  ${progressBar(dayFraction * 100, 18)}\n` +
    `  ✅ Earned so far:  *${formatUSD(earnedToday)}*\n` +
    `  ⏳ Still incoming: ${formatUSD(remainingToday)}\n` +
    `  📦 Full day total: *${formatUSD(todayDailyEarning)}*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📋 *LAST ${showDays} COMPLETED DAYS*\n\n` +
    (rows.length > 0
      ? rows.join("\n")
      : `  _No completed days yet. Check back tomorrow!_`) +
    `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 *Total earned to date:*\n` +
    `   *+${formatUSD(totalEarned)}*\n\n` +
    `🔁 Profits compound automatically every 24h`
  );
}

export function buildAccountTab(data: AccountData, isDemo: boolean, feeBalance?: number): string {
  const statusLine = isDemo
    ? `🟡 *Demo Preview* — Not yet activated`
    : `🟢 *Active* — Managed by Trading Flux`;

  const feeSection = feeBalance !== undefined
    ? `\n💳 *Fee Wallet*\n   Balance:  *${formatUSD(feeBalance)}*\n`
    : ``;

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
    (data.adjustedBalance != null ? `   Updated:  *${formatUSD(data.adjustedBalance)}*\n` : ``) +
    `   Since:    ${data.startDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}\n` +
    `   Rate:     *+3.00% / day*\n` +
    feeSection +
    `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
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
