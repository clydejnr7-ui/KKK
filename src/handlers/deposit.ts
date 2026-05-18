import { Bot, Context, InlineKeyboard } from "grammy";
import { Redis } from "@upstash/redis";

const WALLET = {
  TRC20: {
    address: "TD1aR1w19wyCDf9GJpn854K39Ct2tbKczN",
    label: "USDT TRC20",
    network: "TRON (TRC20)",
    qrUrl: "https://i.8upload.com/image/bd56036958ca3234/img-20260518-132155-747.jpg",
  },
  ERC20: {
    address: "0xF1dC155EEce939cb1f9f89A58B24aC23FE81D510",
    label: "USDT ERC20",
    network: "Ethereum (ERC20)",
    qrUrl: "https://i.8upload.com/image/c1c7e83dcc27caa8/img-20260518-132950-110.jpg",
  },
} as const;

const USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDT_ERC20_CONTRACT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const TRONGRID_API_KEY = "62267827-ed30-4652-960c-6ff5ba4aa608";
const ETHERSCAN_API_KEY = "9C3GJWEDWZCSI6D3YJ617SAYN1XUP2NVCW";
const MIN_DEPOSIT = 10;
const MIN_FEE_TOPUP = 10;
const WEEKLY_FEE = 3;

type Network = "TRC20" | "ERC20";
type DepositType = "deposit" | "fee_wallet";

function r(): Redis {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

// ── Fee wallet helpers ─────────────────────────────────────────────────────────
export async function getFeeBalance(userId: number): Promise<number> {
  return (await r().get<number>(`fee_bal:${userId}`)) ?? 0;
}

async function addFeeBalance(userId: number, amount: number): Promise<number> {
  const current = await getFeeBalance(userId);
  const newBal = parseFloat((current + amount).toFixed(2));
  await r().set(`fee_bal:${userId}`, newBal);
  return newBal;
}

export async function setFeeBalance(userId: number, amount: number): Promise<number> {
  const newBal = parseFloat(amount.toFixed(2));
  await r().set(`fee_bal:${userId}`, newBal);
  return newBal;
}

async function deductFeeBalance(userId: number): Promise<number> {
  const current = await getFeeBalance(userId);
  const newBal = parseFloat(Math.max(0, current - WEEKLY_FEE).toFixed(2));
  await r().set(`fee_bal:${userId}`, newBal);
  return newBal;
}

// ── Redis deposit state ────────────────────────────────────────────────────────
interface DepositStep {
  network: Network;
  type: DepositType;
}

interface PendingDeposit {
  userId: number;
  network: Network;
  type: DepositType;
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

// ── Short premium receipt ──────────────────────────────────────────────────────
function buildReceipt(opts: {
  network: Network;
  amount: number;
  newFeeBalance: number;
  weeksCovered: number;
  txId: string;
  userId: number;
}): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = now.toUTCString().slice(17, 22) + " UTC";
  const receiptNo = `TF-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(opts.userId).slice(-4)}`;
  const txShort = opts.txId.length > 16 ? opts.txId.slice(0, 8) + "..." + opts.txId.slice(-8) : opts.txId;

  return (
    `╔═══════════════════════════╗\n` +
    `║  🧾  TRADING FLUX RECEIPT  ║\n` +
    `╚═══════════════════════════╝\n\n` +
    `📄 \`${receiptNo}\`  ·  📅 *${dateStr}*\n🕐 *${timeStr}*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `  Network:  *${opts.network === "TRC20" ? "TRON (TRC20)" : "Ethereum (ERC20)"}*\n` +
    `  Amount:   *${opts.amount.toFixed(2)} USDT*\n` +
    `  Status:   ✅ *CONFIRMED*\n\n` +
    `💼 *FEE WALLET*\n` +
    `  Credited: *+$${opts.amount.toFixed(2)}*\n` +
    `  Balance:  *$${opts.newFeeBalance.toFixed(2)}*\n` +
    `  Weeks:    *${opts.weeksCovered} covered*\n\n` +
    `🔗 \`${txShort}\`\n\n` +
    `─────────────────────────\n` +
    `_Trading Flux · MT4/MT5 Account Management_`
  );
}

// ── Keyboards ──────────────────────────────────────────────────────────────────
function networkKeyboard(type: DepositType) {
  return new InlineKeyboard()
    .text("USDT TRC20", `dep_net_TRC20_${type}`).row()
    .text("USDT ERC20", `dep_net_ERC20_${type}`).row()
    .text("🔙 Back", "menu_main");
}

function addressKeyboard(network: Network, type: DepositType) {
  return new InlineKeyboard()
    .text("📸 Show QR Code", `dep_qr_${network}_${type}`).row()
    .text("✅ I've Sent Payment", `dep_sent_${network}_${type}`).row()
    .text("🔙 Choose Network", type === "deposit" ? "menu_deposit" : "menu_fee_topup");
}

// ── Shared senders ─────────────────────────────────────────────────────────────
async function sendDepositMenu(ctx: Context, type: DepositType) {
  const isDeposit = type === "deposit";
  await ctx.reply(
    `┌─────────────────────────┐\n` +
    `│  💰 ${isDeposit ? "DEPOSIT FUNDS         " : "TOP UP FEE WALLET     "}│\n` +
    `└─────────────────────────┘\n\n` +
    (isDeposit
      ? `Add USDT to your Trading Flux account.\n\n📌 Minimum deposit: *$${MIN_DEPOSIT} USDT*\n`
      : `Add USDT to your fee wallet to cover weekly management fees.\n\n📌 Minimum top-up: *$${MIN_FEE_TOPUP} USDT*\n💡 Each week costs *$${WEEKLY_FEE} USDT*\n`) +
    `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🌐 Select your preferred network:\n\n` +
    `  💜 *TRC20* — Recommended\n` +
    `  🔵 *ERC20*\n`,
    { parse_mode: "Markdown", reply_markup: networkKeyboard(type) }
  );
}

async function sendAddressPage(ctx: Context, network: Network, type: DepositType) {
  const coin = WALLET[network];
  const isDeposit = type === "deposit";
  await ctx.reply(
    `┌─────────────────────────┐\n` +
    `│  ${coin.label} ${isDeposit ? "DEPOSIT" : "TOP-UP"}            │\n` +
    `└─────────────────────────┘\n\n` +
    `📋 *Send to this address:*\n\n` +
    `\`${coin.address}\`\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🌐 Network:  *${coin.network}*\n` +
    `💵 Amount:   *Minimum $${isDeposit ? MIN_DEPOSIT : MIN_FEE_TOPUP} USDT*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚠️ *Important:*\n` +
    `  • Send *only USDT* on the *${coin.network}* network\n` +
    `  • Sending wrong token = permanent loss\n\n` +
    `After sending, tap ✅ *I've Sent Payment* below.`,
    { parse_mode: "Markdown", reply_markup: addressKeyboard(network, type) }
  );
}

// ── Blockchain checkers ────────────────────────────────────────────────────────
async function checkTRC20(p: PendingDeposit): Promise<{ found: boolean; txId?: string }> {
  const url =
    `https://api.trongrid.io/v1/accounts/${WALLET.TRC20.address}/transactions/trc20` +
    `?only_to=true&contract_address=${USDT_TRC20_CONTRACT}&min_timestamp=${p.timestamp}&limit=50`;
  const res = await fetch(url, { headers: { "TRON-PRO-API-KEY": TRONGRID_API_KEY } });
  const data: any = await res.json();
  const txs: any[] = data?.data ?? [];
  const match = txs.find((tx) => Math.abs(parseInt(tx.value ?? "0") / 1_000_000 - p.amount) < 0.005);
  return { found: !!match, txId: match?.transaction_id };
}

async function checkERC20(p: PendingDeposit): Promise<{ found: boolean; txId?: string }> {
  const startTs = Math.floor(p.timestamp / 1000);
  const url =
    `https://api.etherscan.io/api?module=account&action=tokentx` +
    `&address=${WALLET.ERC20.address}` +
    `&contractaddress=${USDT_ERC20_CONTRACT}` +
    `&startblock=0&endblock=99999999&sort=desc&apikey=${ETHERSCAN_API_KEY}`;
  const res = await fetch(url);
  const data: any = await res.json();
  const txs: any[] = data?.result ?? [];
  const match = txs.find((tx) => {
    if (parseInt(tx.timeStamp ?? "0") < startTs) return false;
    return Math.abs(parseInt(tx.value ?? "0") / 1_000_000 - p.amount) < 0.005;
  });
  return { found: !!match, txId: match?.hash };
}

// ── Credit: ALL deposits go to fee wallet only ─────────────────────────────────
async function creditBalance(ctx: Context, pending: PendingDeposit, txId: string) {
  await removePending(pending.userId);

  const newFeeBal = await addFeeBalance(pending.userId, pending.amount);
  const weeksCovered = Math.floor(newFeeBal / WEEKLY_FEE);

  try {
    await ctx.api.sendMessage(
      process.env.ADMIN_CHANNEL_ID!,
      `💰 <b>DEPOSIT CONFIRMED</b>\n\n` +
      `👤 User ID: <code>${pending.userId}</code>\n` +
      `🌐 Network: <b>${pending.network}</b>\n` +
      `💵 Amount: <b>${pending.amount.toFixed(2)} USDT</b>\n` +
      `💼 Fee Wallet: <b>$${newFeeBal.toFixed(2)}</b> (${weeksCovered} weeks covered)\n` +
      `🔗 TX: <code>${txId}</code>`,
      { parse_mode: "HTML" }
    );
  } catch { }

  await ctx.reply(
    `╔═══════════════════════════╗\n` +
    `║  ✅  DEPOSIT CONFIRMED!    ║\n` +
    `╚═══════════════════════════╝\n\n` +
    `🎉 *${pending.amount.toFixed(2)} USDT* received!\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💼 *Fee Wallet Balance:* $${newFeeBal.toFixed(2)}\n` +
    `📅 *Weeks Covered:* ${weeksCovered}`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("📊 Dashboard", "menu_balance")
        .text("🏠 Main Menu", "menu_main"),
    }
  );

  await ctx.reply(
    buildReceipt({
      network: pending.network,
      amount: pending.amount,
      newFeeBalance: newFeeBal,
      weeksCovered,
      txId,
      userId: pending.userId,
    }),
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("💼 View Fee Wallet & Pay Fee", "menu_fee"),
    }
  );
}

// ── Text input handler (called from form.ts) ───────────────────────────────────
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
  if (amount < (isDeposit ? MIN_DEPOSIT : MIN_FEE_TOPUP)) {
    await ctx.reply(
      `⚠️ *Minimum is $${isDeposit ? MIN_DEPOSIT : MIN_FEE_TOPUP} USDT.*\n\nYou entered $${amount}. Please enter a higher amount:`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  await clearDepositStep(userId);

  const exactAmount = uniqueAmount(amount);
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
    `⚠️ The unique cents help us identify your payment.\n\n` +
    `⏱ Payment expires in *60 minutes.*`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("✅ I've Sent It — Check Now", "deposit_check").row()
        .text("❌ Cancel", "dep_cancel"),
    }
  );
  return true;
}

// ── Check payment callback ─────────────────────────────────────────────────────
async function handleCheckPayment(ctx: Context) {
  const userId = ctx.from!.id;
  const pending = await getPending(userId);

  if (!pending) {
    await ctx.reply(
      `⚠️ No pending payment found. It may have expired (60 min limit).`,
      {
        reply_markup: new InlineKeyboard()
          .text("💰 New Deposit", "menu_deposit").row()
          .text("🏠 Main Menu", "menu_main"),
      }
    );
    return;
  }

  await ctx.reply("🔍 *Checking blockchain...*\n\n⏳ Please wait a moment.", { parse_mode: "Markdown" });

  let result: { found: boolean; txId?: string };
  try {
    result = pending.network === "TRC20" ? await checkTRC20(pending) : await checkERC20(pending);
  } catch {
    await ctx.reply(`⚠️ Network error while checking. Please try again.`, {
      reply_markup: new InlineKeyboard()
        .text("🔄 Try Again", "deposit_check").row()
        .text("🏠 Main Menu", "menu_main"),
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

// ── Register all handlers ──────────────────────────────────────────────────────
export function registerDepositHandlers(bot: Bot<Context>): void {

  bot.command("deposit", async (ctx) => { await sendDepositMenu(ctx, "deposit"); });

  bot.callbackQuery("menu_deposit", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendDepositMenu(ctx, "deposit");
  });

  bot.callbackQuery("menu_fee", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from!.id;
    const feeBal = await getFeeBalance(userId);

    if (feeBal >= WEEKLY_FEE) {
      const newBal = await deductFeeBalance(userId);

      try {
        await ctx.api.sendMessage(
          process.env.ADMIN_CHANNEL_ID!,
          `💳 <b>WEEKLY FEE AUTO-PAID</b>\n\n` +
          `👤 User ID: <code>${userId}</code>\n` +
          `💵 Deducted: <b>$${WEEKLY_FEE}.00</b> from fee wallet\n` +
          `💼 Remaining balance: <b>$${newBal.toFixed(2)}</b>`,
          { parse_mode: "HTML" }
        );
      } catch { }

      await ctx.reply(
        `╔═══════════════════════════╗\n` +
        `║  ✅  FEE PAID!              ║\n` +
        `╚═══════════════════════════╝\n\n` +
        `🎉 *$${WEEKLY_FEE}.00* deducted from your fee wallet!\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💼 *Remaining Balance:* $${newBal.toFixed(2)}\n` +
        `✅ Account management active for another week.\n\n` +
        `_No crypto transaction needed — paid instantly._`,
        {
          parse_mode: "Markdown",
          reply_markup: new InlineKeyboard()
            .text("📊 Dashboard", "menu_balance")
            .text("💰 Top Up", "menu_fee_topup").row()
            .text("🏠 Main Menu", "menu_main"),
        }
      );
    } else {
      const needed = (WEEKLY_FEE - feeBal).toFixed(2);
      await ctx.reply(
        `┌─────────────────────────┐\n` +
        `│  💳  PAY WEEKLY FEE       │\n` +
        `└─────────────────────────┘\n\n` +
        `💳 *Weekly Fee:*       $${WEEKLY_FEE}.00 USDT\n` +
        `💼 *Your Fee Wallet:* $${feeBal.toFixed(2)} USDT\n` +
        `📉 *Shortfall:*        $${needed} USDT\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `⚠️ *Insufficient fee wallet balance.*\n\n` +
        `Top up your Trading Flux fee wallet with at least *$${MIN_FEE_TOPUP} USDT* and pay future fees instantly — no crypto needed each time.\n\n` +
        `💡 _Topping up $30 covers 10 weeks at once._`,
        {
          parse_mode: "Markdown",
          reply_markup: new InlineKeyboard()
            .text("💰 Top Up Fee Wallet", "menu_fee_topup").row()
            .text("🏠 Main Menu", "menu_main"),
        }
      );
    }
  });

  bot.callbackQuery("menu_fee_topup", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendDepositMenu(ctx, "fee_wallet");
  });

  bot.callbackQuery(/^dep_net_(TRC20|ERC20)_(deposit|fee_wallet)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, network, type] = ctx.match as RegExpMatchArray;
    await setDepositStep(ctx.from!.id, { network: network as Network, type: type as DepositType });
    await sendAddressPage(ctx, network as Network, type as DepositType);
  });

  bot.callbackQuery(/^dep_qr_(TRC20|ERC20)_(deposit|fee_wallet)$/, async (ctx) => {
    await ctx.answerCallbackQuery("Loading QR code...");
    const [, network, type] = ctx.match as RegExpMatchArray;
    const coin = WALLET[network as Network];
    const isDeposit = type === "deposit";
    await ctx.replyWithPhoto(coin.qrUrl, {
      caption:
        `📸 *${coin.label} QR Code*\n\n` +
        `🌐 Network: *${coin.network}*\n` +
        `💵 ${isDeposit ? `Minimum: *$${MIN_DEPOSIT} USDT*` : `Minimum: *$${MIN_FEE_TOPUP} USDT*`}\n\n` +
        `Or copy address manually:\n\`${coin.address}\``,
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("✅ I've Sent Payment", `dep_sent_${network}_${type}`).row()
        .text("🔙 Back to Address", `dep_net_${network}_${type}`),
    });
  });

  bot.callbackQuery(/^dep_sent_(TRC20|ERC20)_(deposit|fee_wallet)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, network, type] = ctx.match as RegExpMatchArray;
    const isDeposit = type === "deposit";
    await setDepositStep(ctx.from!.id, { network: network as Network, type: type as DepositType });
    await ctx.reply(
      `💬 *How much did you send?*\n\n` +
      `Enter the exact USDT amount:\n_e.g._ \`${isDeposit ? "50" : "10"}\`\n\n` +
      `${isDeposit ? `📌 Minimum: *$${MIN_DEPOSIT} USDT*` : `📌 Minimum: *$${MIN_FEE_TOPUP} USDT*`}`,
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
      `❌ *Payment cancelled.*`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("💰 Try Again", "menu_deposit").row()
          .text("🏠 Main Menu", "menu_main"),
      }
    );
  });
}
