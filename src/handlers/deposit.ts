import { Context, InlineKeyboard } from "grammy";
import { Redis } from "@upstash/redis";
import { computeBalance } from "../utils/balance";

const USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDT_ERC20_CONTRACT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

type Network = "TRC20" | "ERC20";

function r(): Redis {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

export interface PendingDeposit {
  userId: number;
  network: Network;
  amount: number;
  baseAmount: number;
  timestamp: number;
  wallet: string;
}

export async function savePendingDeposit(deposit: PendingDeposit): Promise<void> {
  await r().set(`deposit:${deposit.userId}`, deposit, { ex: 3600 });
}

export async function getPendingDeposit(userId: number): Promise<PendingDeposit | null> {
  return r().get<PendingDeposit>(`deposit:${userId}`);
}

export async function removePendingDeposit(userId: number): Promise<void> {
  await r().del(`deposit:${userId}`);
}

function uniqueAmount(base: number): number {
  const cents = Math.floor(Math.random() * 89) + 10;
  return parseFloat((base + cents / 100).toFixed(2));
}

// ── Step 1: Ask which network ─────────────────────────────────────────────────
export async function handleDepositStart(ctx: Context): Promise<void> {
  const hasTRC20 = !!process.env.DEPOSIT_WALLET_TRC20;
  const hasERC20 = !!process.env.DEPOSIT_WALLET_ERC20;

  if (!hasTRC20 && !hasERC20) {
    await ctx.reply("⚠️ Deposit wallet not configured. Please contact support.", {
      reply_markup: new InlineKeyboard().text("🏠 Main Menu", "menu_main"),
    });
    return;
  }

  const kb = new InlineKeyboard();
  if (hasTRC20) kb.text("🔵 USDT TRC20 (Tron)", "deposit_net_TRC20").row();
  if (hasERC20) kb.text("🟣 USDT ERC20 (Ethereum)", "deposit_net_ERC20").row();
  kb.text("❌ Cancel", "menu_main");

  await ctx.reply(
    `💰 *Add Deposit*\n${"─".repeat(28)}\n\n` +
    `Select the network you will send USDT on:\n\n` +
    `🔵 *TRC20 (Tron)* — Fast, near-zero fees\n` +
    `🟣 *ERC20 (Ethereum)* — Higher fees, slower`,
    { parse_mode: "Markdown", reply_markup: kb }
  );
}

// ── Step 2: Network selected → ask amount ─────────────────────────────────────
export async function handleNetworkSelected(ctx: Context, network: Network): Promise<void> {
  await r().set(`deposit_step:${ctx.from!.id}`, `awaiting_amount:${network}`, { ex: 300 });

  const networkLabel = network === "TRC20" ? "🔵 TRC20 (Tron)" : "🟣 ERC20 (Ethereum)";

  await ctx.reply(
    `${networkLabel}\n\n` +
    `How much USDT do you want to deposit?\n\n` +
    `_Minimum: $10 USDT_\n` +
    `_Enter numbers only (e.g._ \`500\`_)_`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("🔙 Back", "menu_deposit")
        .text("❌ Cancel", "menu_main"),
    }
  );
}

// ── Step 3: Amount entered → show payment instructions ────────────────────────
export async function handleDepositTextInput(ctx: Context): Promise<boolean> {
  const userId = ctx.from!.id;
  const step = await r().get<string>(`deposit_step:${userId}`);
  if (!step || !step.startsWith("awaiting_amount:")) return false;

  const network = step.split(":")[1] as Network;
  const text = ctx.message!.text.trim();
  const amount = parseFloat(text.replace(/[^0-9.]/g, ""));

  if (isNaN(amount) || amount < 10) {
    await ctx.reply(
      `⚠️ *Invalid amount*\n\nMinimum deposit is $10 USDT.\nPlease enter a valid amount:`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("❌ Cancel", "menu_main") }
    );
    return true;
  }

  await r().del(`deposit_step:${userId}`);

  const wallet = network === "TRC20"
    ? process.env.DEPOSIT_WALLET_TRC20!
    : process.env.DEPOSIT_WALLET_ERC20!;

  const exactAmount = uniqueAmount(amount);
  const pending: PendingDeposit = {
    userId, network, amount: exactAmount, baseAmount: amount,
    timestamp: Date.now(), wallet,
  };
  await savePendingDeposit(pending);

  const networkLabel = network === "TRC20" ? "TRON (TRC20)" : "Ethereum (ERC20)";
  const networkWarn = network === "TRC20"
    ? "• Do NOT send BEP20 or ERC20 USDT"
    : "• Do NOT send BEP20 or TRC20 USDT";

  await ctx.reply(
    `╔═══════════════════════════╗\n` +
    `║  💳  DEPOSIT INSTRUCTIONS  ║\n` +
    `╚═══════════════════════════╝\n\n` +
    `Network: *${networkLabel}*\n\n` +
    `Send *exactly* this amount:\n\n` +
    `┌─────────────────────────┐\n` +
    `│  💵  *${exactAmount.toFixed(2)} USDT*                │\n` +
    `└─────────────────────────┘\n\n` +
    `📬 *To this wallet:*\n` +
    `\`${wallet}\`\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚠️ *Important:*\n` +
    `  • Send on *${networkLabel}* network only\n` +
    `  • Send the *exact amount shown* above\n` +
    `  ${networkWarn}\n` +
    `  • Payment expires in *60 minutes*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `After sending, tap the button below.`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("✅ I've Sent It — Check Now", "deposit_check").row()
        .text("❌ Cancel Deposit", "deposit_cancel"),
    }
  );

  return true;
}

// ── Blockchain check ──────────────────────────────────────────────────────────
async function checkTRC20(pending: PendingDeposit): Promise<{ found: boolean; txId?: string }> {
  const apiKey = process.env.TRONGRID_API_KEY ?? "";
  const url =
    `https://api.trongrid.io/v1/accounts/${pending.wallet}/transactions/trc20` +
    `?only_to=true&contract_address=${USDT_TRC20_CONTRACT}&min_timestamp=${pending.timestamp}&limit=50`;

  const res = await fetch(url, {
    headers: apiKey ? { "TRON-PRO-API-KEY": apiKey } : {},
  });
  const data: any = await res.json();
  const txs: any[] = data?.data ?? [];

  const match = txs.find((tx) => {
    const value = parseInt(tx.value ?? "0") / 1_000_000;
    return Math.abs(value - pending.amount) < 0.005;
  });

  return { found: !!match, txId: match?.transaction_id };
}

async function checkERC20(pending: PendingDeposit): Promise<{ found: boolean; txId?: string }> {
  const apiKey = process.env.ETHERSCAN_API_KEY ?? "";
  const startTimestamp = Math.floor(pending.timestamp / 1000);
  const url =
    `https://api.etherscan.io/api?module=account&action=tokentx` +
    `&address=${pending.wallet}` +
    `&contractaddress=${USDT_ERC20_CONTRACT}` +
    `&startblock=0&endblock=99999999&sort=desc` +
    `&apikey=${apiKey}`;

  const res = await fetch(url);
  const data: any = await res.json();
  const txs: any[] = data?.result ?? [];

  const match = txs.find((tx) => {
    const ts = parseInt(tx.timeStamp ?? "0");
    if (ts < startTimestamp) return false;
    // USDT ERC20 has 6 decimals
    const value = parseInt(tx.value ?? "0") / 1_000_000;
    return Math.abs(value - pending.amount) < 0.005;
  });

  return { found: !!match, txId: match?.hash };
}

export async function checkDepositForUser(userId: number): Promise<{
  found: boolean;
  amount?: number;
  txId?: string;
  error?: string;
}> {
  const pending = await getPendingDeposit(userId);
  if (!pending) return { found: false, error: "No pending deposit found." };

  try {
    const result = pending.network === "TRC20"
      ? await checkTRC20(pending)
      : await checkERC20(pending);

    return { found: result.found, amount: pending.amount, txId: result.txId };
  } catch (e: any) {
    return { found: false, error: "Network error checking blockchain. Try again." };
  }
}

// ── Credit confirmed deposit to balance ───────────────────────────────────────
export async function creditDeposit(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  const pending = await getPendingDeposit(userId);

  if (!pending) {
    await ctx.reply("⚠️ No pending deposit found. It may have expired.", {
      reply_markup: new InlineKeyboard()
        .text("💰 New Deposit", "menu_deposit").row()
        .text("🏠 Main Menu", "menu_main"),
    });
    return;
  }

  await ctx.reply("🔍 *Checking blockchain...*\n\n⏳ Please wait a moment.", { parse_mode: "Markdown" });

  const result = await checkDepositForUser(userId);

  if (result.error) {
    await ctx.reply(`⚠️ ${result.error}`, {
      reply_markup: new InlineKeyboard()
        .text("🔄 Try Again", "deposit_check").row()
        .text("🏠 Main Menu", "menu_main"),
    });
    return;
  }

  if (!result.found) {
    await ctx.reply(
      `⏳ *Payment Not Detected Yet*\n\n` +
      `We couldn't find your transaction on the blockchain yet.\n\n` +
      `*${pending.network === "TRC20" ? "TRC20 (Tron)" : "ERC20 (Ethereum)"}:* ` +
      (pending.network === "TRC20"
        ? "Usually confirms within 1–3 minutes."
        : "Usually confirms within 2–5 minutes.") +
      `\n\nMake sure you sent *exactly ${pending.amount.toFixed(2)} USDT*.`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("🔄 Check Again", "deposit_check").row()
          .text("❌ Cancel Deposit", "deposit_cancel"),
      }
    );
    return;
  }

  // ── Payment confirmed — update balance ────────────────────────────────────
  await removePendingDeposit(userId);

  const redis = r();
  const account = await redis.get<any>(`acct:${userId}`);
  const now = new Date();
  let newDeposit: number;

  if (account) {
    const msPerDay = 86_400_000;
    const startDate = new Date(account.startDate as string);
    const daysElapsed = Math.max(0, Math.floor((now.getTime() - startDate.getTime()) / msPerDay));
    const currentBalance = computeBalance(account.deposit, daysElapsed);
    newDeposit = parseFloat((currentBalance + pending.amount).toFixed(2));

    await redis.set(`acct:${userId}`, {
      ...account,
      deposit: newDeposit,
      startDate: now.toISOString(),
    });
  } else {
    newDeposit = pending.amount;
  }

  // Notify admin
  try {
    await ctx.api.sendMessage(
      process.env.ADMIN_CHANNEL_ID!,
      `💰 <b>DEPOSIT CONFIRMED</b>\n\n` +
      `👤 User ID: <code>${userId}</code>\n` +
      `🌐 Network: <b>${pending.network}</b>\n` +
      `💵 Amount: <b>${pending.amount.toFixed(2)} USDT</b>\n` +
      `🔗 TX: <code>${result.txId}</code>\n` +
      `💼 New Principal: <b>$${newDeposit.toFixed(2)}</b>`,
      { parse_mode: "HTML" }
    );
  } catch (e) { /* non-fatal */ }

  await ctx.reply(
    `╔═══════════════════════════╗\n` +
    `║  ✅  DEPOSIT CONFIRMED!    ║\n` +
    `╚═══════════════════════════╝\n\n` +
    `🎉 *${pending.amount.toFixed(2)} USDT* has been credited!\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 *New Balance:* $${newDeposit.toFixed(2)}\n` +
    `📅 Compounding restarted from today\n` +
    `📈 Rate: *+3% / day*\n\n` +
    `🔗 TX: \`${result.txId}\``,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text("🏠 Main Menu", "menu_main"),
    }
  );
}
