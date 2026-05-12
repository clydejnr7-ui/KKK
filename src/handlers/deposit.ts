import { Bot, Context, InlineKeyboard } from "grammy";

// ─── Crypto config ─────────────────────────────────────────────────────────
const CRYPTO = {
  TRC20: {
    label: "💜 USDT TRC20",
    network: "TRON (TRC20)",
    address: "TMqZgyf2wjfrXBudHk3p7uYYGP7D9PZvLt",
    qrUrl: "https://i.8upload.com/image/0ecb47f67b15073b/download-2.png",
    fee: "~1 USDT",
  },
  ERC20: {
    label: "🔵 USDT ERC20",
    network: "Ethereum (ERC20)",
    address: "0xc2839F2Dd23B42C227DD91664fD0479659fC4610",
    qrUrl: "https://i.8upload.com/image/21fc625d9d174723/download-3.png",
    fee: "~5–15 USD gas",
  },
};

const MIN_DEPOSIT = 10;
const WEEKLY_FEE = 3;

// ─── In-progress deposit state ──────────────────────────────────────────────
interface DepositState {
  step: "awaiting_amount";
  network: "TRC20" | "ERC20";
  type: "deposit" | "fee";
}
export const depositState = new Map<number, DepositState>();

// ─── Keyboards ──────────────────────────────────────────────────────────────
function networkKeyboard(type: "deposit" | "fee"): InlineKeyboard {
  return new InlineKeyboard()
    .text("💜 USDT TRC20", `dep_net_TRC20_${type}`).row()
    .text("🔵 USDT ERC20", `dep_net_ERC20_${type}`).row()
    .text("🔙 Back", "menu_main");
}

function addressKeyboard(network: "TRC20" | "ERC20", type: "deposit" | "fee"): InlineKeyboard {
  return new InlineKeyboard()
    .text("📸 Show QR Code", `dep_qr_${network}_${type}`).row()
    .text("✅ I've Sent Payment", `dep_sent_${network}_${type}`).row()
    .text("🔙 Choose Network", type === "deposit" ? "menu_deposit" : "menu_fee");
}

// ─── Shared senders ─────────────────────────────────────────────────────────
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

async function sendAddressPage(ctx: Context, network: "TRC20" | "ERC20", type: "deposit" | "fee") {
  const coin = CRYPTO[network];
  const isDeposit = type === "deposit";
  const amount = isDeposit ? `Minimum $${MIN_DEPOSIT} USD` : `Exactly $${WEEKLY_FEE} USDT`;

  const text =
    `┌─────────────────────────┐\n` +
    `│  ${coin.label} ${isDeposit ? "DEPOSIT" : "FEE PAYMENT"}${"           ".slice((coin.label + (isDeposit ? " DEPOSIT" : " FEE PAYMENT")).length)}│\n` +
    `└─────────────────────────┘\n\n` +
    `📋 *Send to this address:*\n\n` +
    `\`${coin.address}\`\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🌐 Network:    *${coin.network}*\n` +
    `💵 Amount:     *${amount}*\n` +
    `⛽ Est. fee:   ${coin.fee}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚠️ *Important:*\n` +
    `  • Send *only USDT* on the *${coin.network}* network\n` +
    `  • Sending wrong token = permanent loss\n` +
    `  • Tap QR code for easy scanning\n\n` +
    `After sending, tap ✅ *I've Sent Payment* to notify our team.`;

  await ctx.reply(text, {
    parse_mode: "Markdown",
    reply_markup: addressKeyboard(network, type),
  });
}

// ─── Text input handler (called from form.ts message router) ─────────────────
export async function handleDepositTextInput(ctx: Context): Promise<boolean> {
  const userId = ctx.from!.id;
  const state = depositState.get(userId);
  if (!state) return false;

  const text = (ctx.message as any)?.text?.trim() ?? "";
  if (!text || text.startsWith("/")) return false;

  // Awaiting amount
  if (state.step === "awaiting_amount") {
    const amount = parseFloat(text.replace(/[^0-9.]/g, ""));
    const isDeposit = state.type === "deposit";
    const minAmount = isDeposit ? MIN_DEPOSIT : WEEKLY_FEE;

    if (isNaN(amount) || amount <= 0) {
      await ctx.reply(
        `⚠️ *Invalid amount.*\n\nEnter a number (e.g. \`50\`):`,
        { parse_mode: "Markdown" }
      );
      return true;
    }

    if (isDeposit && amount < MIN_DEPOSIT) {
      await ctx.reply(
        `⚠️ *Minimum deposit is $${MIN_DEPOSIT} USDT.*\n\nYou entered $${amount}. Please enter a higher amount:`,
        { parse_mode: "Markdown" }
      );
      return true;
    }

    const coin = CRYPTO[state.network];
    depositState.delete(userId);

    // Notify admin (HTML parse mode — safe against special chars in user data)
    const adminChannelId = process.env.ADMIN_CHANNEL_ID!;
    const username = ctx.from?.username ? `@${ctx.from.username}` : `ID: ${userId}`;
    const adminMsg =
      `${isDeposit ? "💰" : "💳"} <b>${isDeposit ? "DEPOSIT" : "FEE PAYMENT"} REQUEST — Trading Flux</b>\n\n` +
      `${"━".repeat(30)}\n` +
      `👤 <b>Client</b>\n` +
      `   Telegram: ${username}\n` +
      `   User ID:  <code>${userId}</code>\n\n` +
      `${"━".repeat(30)}\n` +
      `💵 <b>Payment Details</b>\n` +
      `   Type:     <b>${isDeposit ? "Deposit" : "Weekly Fee"}</b>\n` +
      `   Amount:   <b>$${amount.toFixed(2)} USDT</b>\n` +
      `   Network:  <b>${coin.network}</b>\n` +
      `   Address:  <code>${coin.address}</code>\n\n` +
      `${"━".repeat(30)}\n` +
      `🕐 Submitted: ${new Date().toUTCString()}\n` +
      `📌 Status: <b>🟡 Pending Approval</b>\n\n` +
      `Verify on-chain, then approve this user's ${isDeposit ? "balance" : "fee"}.`;

    try {
      await ctx.api.sendMessage(adminChannelId, adminMsg, { parse_mode: "HTML" });
    } catch (e) {
      console.error("Admin notification error:", e);
    }

    // Confirm to user
    await ctx.reply(
      `┌─────────────────────────┐\n` +
      `│  ✅  PAYMENT SUBMITTED   │\n` +
      `└─────────────────────────┘\n\n` +
      `Thank you! Your ${isDeposit ? "deposit" : "fee payment"} has been received by our team.\n\n` +
      `${"━".repeat(28)}\n` +
      `📋 *Your Submission*\n` +
      `   Amount:  *$${amount.toFixed(2)} USDT*\n` +
      `   Network: *${coin.network}*\n` +
      `   Type:    *${isDeposit ? "Deposit" : "Weekly Fee"}*\n\n` +
      `${"━".repeat(28)}\n` +
      `⏳ *What happens next:*\n` +
      `  1️⃣ Our team verifies your transaction on-chain\n` +
      `  2️⃣ ${isDeposit ? "Your balance is activated (within 24h)" : "Your fee is marked as paid"}\n` +
      `  3️⃣ You'll see your balance in the dashboard\n\n` +
      `📊 Check your balance anytime using the button below.`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("📊 View Dashboard", "menu_balance").row()
          .text("🏠 Main Menu", "menu_main"),
      }
    );
    return true;
  }

  return false;
}

// ─── Register all deposit callbacks ─────────────────────────────────────────
export function registerDepositHandlers(bot: Bot<Context>): void {

  // ── /deposit command ────────────────────────────────────────────────────
  bot.command("deposit", async (ctx) => {
    await sendDepositMenu(ctx, "deposit");
  });

  // ── Menu button callbacks ────────────────────────────────────────────────
  bot.callbackQuery("menu_deposit", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendDepositMenu(ctx, "deposit");
  });

  bot.callbackQuery("menu_fee", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendDepositMenu(ctx, "fee");
  });

  // ── Network selection ────────────────────────────────────────────────────
  bot.callbackQuery(/^dep_net_(TRC20|ERC20)_(deposit|fee)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, network, type] = ctx.match as RegExpMatchArray;
    await sendAddressPage(ctx, network as "TRC20" | "ERC20", type as "deposit" | "fee");
  });

  // ── Show QR code ─────────────────────────────────────────────────────────
  bot.callbackQuery(/^dep_qr_(TRC20|ERC20)_(deposit|fee)$/, async (ctx) => {
    await ctx.answerCallbackQuery("Loading QR code...");
    const [, network, type] = ctx.match as RegExpMatchArray;
    const coin = CRYPTO[network as "TRC20" | "ERC20"];
    const isDeposit = type === "deposit";

    await ctx.replyWithPhoto(coin.qrUrl, {
      caption:
        `📸 *${coin.label} QR Code*\n\n` +
        `Scan with your wallet app to get the address.\n\n` +
        `🌐 Network: *${coin.network}*\n` +
        `💵 ${isDeposit ? `Minimum: *$${MIN_DEPOSIT} USDT*` : `Amount: *$${WEEKLY_FEE} USDT*`}\n\n` +
        `Or copy the address manually:\n\`${coin.address}\``,
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("✅ I've Sent Payment", `dep_sent_${network}_${type}`).row()
        .text("🔙 Back to Address", `dep_net_${network}_${type}`),
    });
  });

  // ── "I've sent" → ask amount ─────────────────────────────────────────────
  bot.callbackQuery(/^dep_sent_(TRC20|ERC20)_(deposit|fee)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, network, type] = ctx.match as RegExpMatchArray;
    const userId = ctx.from!.id;
    const isDeposit = type === "deposit";

    depositState.set(userId, {
      step: "awaiting_amount",
      network: network as "TRC20" | "ERC20",
      type: type as "deposit" | "fee",
    });

    await ctx.reply(
      `💬 *How much did you send?*\n\n` +
      `Enter the exact USDT amount you sent:\n` +
      `_e.g._ \`${isDeposit ? "50" : "3"}\`\n\n` +
      `${isDeposit ? `📌 Minimum: *$${MIN_DEPOSIT} USDT*` : `📌 Fee amount: *$${WEEKLY_FEE} USDT*`}`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("❌ Cancel", "dep_cancel"),
      }
    );
  });

  // ── Cancel deposit ────────────────────────────────────────────────────────
  bot.callbackQuery("dep_cancel", async (ctx) => {
    await ctx.answerCallbackQuery("Cancelled");
    depositState.delete(ctx.from!.id);
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
