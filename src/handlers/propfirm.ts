import { Bot, Context, InlineKeyboard } from "grammy";
import { Redis } from "@upstash/redis";

// ── Wallet config (mirrors deposit.ts) ────────────────────────────────────────
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

// ── Prop firm plans ────────────────────────────────────────────────────────────
export const PROP_PLANS: { size: number; price: number; label: string; tag: string }[] = [
  { size: 5_000,   price: 45,  label: "$5K Account",   tag: "5k"   },
  { size: 10_000,  price: 65,  label: "$10K Account",  tag: "10k"  },
  { size: 25_000,  price: 119, label: "$25K Account",  tag: "25k"  },
  { size: 50_000,  price: 215, label: "$50K Account",  tag: "50k"  },
  { size: 100_000, price: 380, label: "$100K Account", tag: "100k" },
  { size: 200_000, price: 620, label: "$200K Account", tag: "200k" },
];

type Network = "TRC20" | "ERC20";
type OrderStatus = "pending_payment" | "payment_received" | "in_progress" | "completed" | "failed";
type CredStep = "platform" | "broker" | "login" | "password" | "server";

interface PropFirmPending {
  userId: number;
  network: Network;
  amount: number;
  baseAmount: number;
  accountSize: number;
  price: number;
  timestamp: number;
}

interface PropFirmCredData {
  platform?: string;
  broker?: string;
  accountNumber?: string;
  password?: string;
  serverName?: string;
}

interface PropFirmOrder {
  orderId: string;
  userId: number;
  userName?: string;
  accountSize: number;
  price: number;
  network: Network;
  exactAmount: number;
  txId: string;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
  platform?: string;
  broker?: string;
  accountNumber?: string;
  serverName?: string;
  failReason?: string;
}

function r(): Redis {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

function isAdminChannel(ctx: Context): boolean {
  return !!process.env.ADMIN_CHANNEL_ID && ctx.chat?.id.toString() === process.env.ADMIN_CHANNEL_ID;
}

async function savePfPending(p: PropFirmPending) {
  await r().set(`pf_pending:${p.userId}`, p, { ex: 3600 });
}
async function getPfPending(userId: number): Promise<PropFirmPending | null> {
  return r().get<PropFirmPending>(`pf_pending:${userId}`);
}
async function removePfPending(userId: number) {
  await r().del(`pf_pending:${userId}`);
}

async function setPfCredStep(userId: number, step: CredStep) {
  await r().set(`pf_cred_step:${userId}`, step, { ex: 600 });
}
async function getPfCredStep(userId: number): Promise<CredStep | null> {
  return r().get<CredStep>(`pf_cred_step:${userId}`);
}
async function clearPfCredStep(userId: number) {
  await r().del(`pf_cred_step:${userId}`);
  await r().del(`pf_cred_data:${userId}`);
}

async function savePfCredData(userId: number, data: PropFirmCredData) {
  await r().set(`pf_cred_data:${userId}`, data, { ex: 600 });
}
async function getPfCredData(userId: number): Promise<PropFirmCredData> {
  return (await r().get<PropFirmCredData>(`pf_cred_data:${userId}`)) ?? {};
}

async function saveOrder(order: PropFirmOrder) {
  await r().set(`pf_order:${order.orderId}`, order);
  await r().rpush(`pf_orders:${order.userId}`, order.orderId);
  await r().sadd("pf_all_orders", order.orderId);
}

async function getOrder(orderId: string): Promise<PropFirmOrder | null> {
  return r().get<PropFirmOrder>(`pf_order:${orderId}`);
}

async function updateOrderStatus(orderId: string, status: OrderStatus, extra: Partial<PropFirmOrder> = {}) {
  const order = await getOrder(orderId);
  if (!order) return null;
  const updated: PropFirmOrder = { ...order, ...extra, status, updatedAt: Date.now() };
  await r().set(`pf_order:${orderId}`, updated);
  return updated;
}

async function getUserOrders(userId: number): Promise<PropFirmOrder[]> {
  const ids = await r().lrange<string>(`pf_orders:${userId}`, 0, -1);
  if (!ids || ids.length === 0) return [];
  const orders = await Promise.all(ids.map((id) => getOrder(id)));
  return (orders.filter(Boolean) as PropFirmOrder[]).reverse();
}

async function setPfSizeStep(userId: number, tag: string) {
  await r().set(`pf_size_step:${userId}`, tag, { ex: 600 });
}
async function clearPfSizeStep(userId: number) {
  await r().del(`pf_size_step:${userId}`);
}

async function setPfFailStep(adminChatId: string, orderId: string) {
  await r().set(`pf_fail_step:${adminChatId}`, orderId, { ex: 300 });
}
async function getPfFailStep(adminChatId: string): Promise<string | null> {
  return r().get<string>(`pf_fail_step:${adminChatId}`);
}
async function clearPfFailStep(adminChatId: string) {
  await r().del(`pf_fail_step:${adminChatId}`);
}

function uniqueAmount(base: number): number {
  const cents = Math.floor(Math.random() * 89) + 10;
  return parseFloat((base + cents / 100).toFixed(2));
}

function newOrderId(userId: number): string {
  const now = new Date();
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const rand = Math.floor(Math.random() * 900) + 100;
  return `PF-${datePart}-${String(userId).slice(-4)}${rand}`;
}

function statusEmoji(s: OrderStatus): string {
  return s === "pending_payment" ? "⏳"
    : s === "payment_received" ? "💳"
    : s === "in_progress" ? "⚙️"
    : s === "completed" ? "✅"
    : "❌";
}
function statusLabel(s: OrderStatus): string {
  return s === "pending_payment" ? "Pending Payment"
    : s === "payment_received" ? "Payment Received"
    : s === "in_progress" ? "In Progress"
    : s === "completed" ? "Completed"
    : "Failed";
}
function formatSize(size: number): string {
  return size >= 1000 ? `$${(size / 1000).toFixed(0)}K` : `$${size}`;
}

async function checkTRC20(p: PropFirmPending): Promise<{ found: boolean; txId?: string }> {
  const url =
    `https://api.trongrid.io/v1/accounts/${WALLET.TRC20.address}/transactions/trc20` +
    `?only_to=true&contract_address=${USDT_TRC20_CONTRACT}&min_timestamp=${p.timestamp}&limit=50`;
  const res = await fetch(url, { headers: { "TRON-PRO-API-KEY": TRONGRID_API_KEY } });
  const data: any = await res.json();
  const txs: any[] = data?.data ?? [];
  const match = txs.find((tx) => Math.abs(parseInt(tx.value ?? "0") / 1_000_000 - p.amount) < 0.005);
  return { found: !!match, txId: match?.transaction_id };
}

async function checkERC20(p: PropFirmPending): Promise<{ found: boolean; txId?: string }> {
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

function buildPfReceipt(order: PropFirmOrder): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = now.toUTCString().slice(17, 22) + " UTC";
  const txShort = order.txId.length > 16 ? order.txId.slice(0, 8) + "..." + order.txId.slice(-8) : order.txId;
  return (
    `╔═══════════════════════════╗\n` +
    `║  🧾  PROP FIRM RECEIPT     ║\n` +
    `╚═══════════════════════════╝\n\n` +
    `📄 \`${order.orderId}\`\n` +
    `📅 *${dateStr}*  ·  🕐 *${timeStr}*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🏆 *Service:* Prop Firm Challenge Passing\n` +
    `📊 *Account Size:* ${formatSize(order.accountSize)} (Both Phases)\n` +
    `🌐 *Network:* ${order.network === "TRC20" ? "TRON (TRC20)" : "Ethereum (ERC20)"}\n` +
    `💵 *Amount Paid:* ${order.exactAmount.toFixed(2)} USDT\n` +
    `✅ *Status:* PAYMENT CONFIRMED\n\n` +
    `🔗 \`${txShort}\`\n\n` +
    `─────────────────────────\n` +
    `_Trading Flux · Prop Firm Services_`
  );
}

function buildAdminOrderCard(order: PropFirmOrder, userName?: string): string {
  const createdAt = new Date(order.createdAt).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  return (
    `╔═══════════════════════════╗\n` +
    `║  🏆  PROP FIRM ORDER       ║\n` +
    `╚═══════════════════════════╝\n\n` +
    `📋 <b>Order ID:</b> <code>${order.orderId}</code>\n` +
    `👤 <b>User:</b> ${userName ?? "—"} (<code>${order.userId}</code>)\n` +
    `📅 <b>Submitted:</b> ${createdAt}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 <b>Account Size:</b> ${formatSize(order.accountSize)} (Both Phases)\n` +
    `💵 <b>Price Paid:</b> $${order.price}.00 USDT\n` +
    `🌐 <b>Network:</b> ${order.network}\n` +
    `🔗 <b>TX:</b> <code>${order.txId}</code>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🖥 <b>Platform:</b> ${order.platform ?? "Not yet provided"}\n` +
    `🏦 <b>Broker:</b> ${order.broker ?? "Not yet provided"}\n` +
    `🔑 <b>Login:</b> <code>${order.accountNumber ?? "Not yet provided"}</code>\n` +
    `🌐 <b>Server:</b> <code>${order.serverName ?? "Not yet provided"}</code>\n`
  );
}

async function sendPropFirmDashboard(ctx: Context) {
  const userId = ctx.from!.id;
  const orders = await getUserOrders(userId);
  const activeOrders = orders.filter((o) => o.status !== "completed" && o.status !== "failed");
  const completedOrders = orders.filter((o) => o.status === "completed");
  const totalSpent = orders.reduce((sum, o) => sum + o.price, 0);

  let dashBody = "";
  if (activeOrders.length > 0) {
    dashBody += `\n📋 *ACTIVE ORDERS*\n${"─".repeat(26)}\n`;
    for (const o of activeOrders) {
      dashBody +=
        `\n${statusEmoji(o.status)} *${formatSize(o.accountSize)}* — \`${o.orderId}\`\n` +
        `   Status: *${statusLabel(o.status)}*\n`;
    }
  }
  if (completedOrders.length > 0) {
    dashBody += `\n✅ *PASSED CHALLENGES:* ${completedOrders.length}\n`;
  }

  const headerBox =
    `╔═══════════════════════════╗\n` +
    `║   🏆  PROP FIRM SERVICES   ║\n` +
    `║  Challenge Passing Hub    ║\n` +
    `╚═══════════════════════════╝`;

  const statsLine =
    orders.length === 0
      ? `\n🎯 *Start your first challenge order below.*\n\n` +
        `We pass both Phase 1 and Phase 2 for you — fully managed by our expert trading team.`
      : `\n📦 *Total Orders:* ${orders.length}    ✅ *Passed:* ${completedOrders.length}    💵 *Invested:* $${totalSpent}`;

  const msg =
    `${headerBox}\n` +
    `${statsLine}\n` +
    dashBody +
    `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💡 _We pass both phases. You keep the funded account._`;

  const kb = new InlineKeyboard()
    .text("🚀 New Challenge Order", "pf_new_order").row();
  if (activeOrders.length > 0) {
    kb.text("📋 My Orders", "pf_my_orders").row();
  }
  kb.text("💡 How It Works", "pf_how_it_works").row()
    .text("🏠 Main Menu", "menu_main");

  await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: kb });
}

async function sendSizeSelector(ctx: Context) {
  const kb = new InlineKeyboard();
  PROP_PLANS.forEach((plan, i) => {
    kb.text(`${plan.label} — $${plan.price}`, `pf_size_${plan.tag}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row().text("🔙 Back", "menu_propfirm");

  await ctx.reply(
    `┌─────────────────────────┐\n` +
    `│  📊  SELECT ACCOUNT SIZE  │\n` +
    `└─────────────────────────┘\n\n` +
    `All packages include *both Phase 1 & Phase 2*.\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🏆 *Our Promise:*\n` +
    `✅  Pass both phases or money back\n` +
    `✅  Expert traders on your account\n` +
    `✅  Usually completed in 7–21 days\n` +
    `✅  All major prop firms supported\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👇 *Choose your account size:*`,
    { parse_mode: "Markdown", reply_markup: kb }
  );
}

async function sendPfNetworkSelector(ctx: Context, plan: typeof PROP_PLANS[0]) {
  await ctx.reply(
    `┌─────────────────────────┐\n` +
    `│  💳  PAYMENT METHOD       │\n` +
    `└─────────────────────────┘\n\n` +
    `📊 *Package:* ${plan.label} (Both Phases)\n` +
    `💵 *Total:*   *$${plan.price}.00 USDT*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🌐 Select your payment network:`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("💜 USDT TRC20 (Recommended)", `pf_net_TRC20_${plan.tag}`).row()
        .text("🔵 USDT ERC20", `pf_net_ERC20_${plan.tag}`).row()
        .text("🔙 Choose Different Size", "pf_new_order"),
    }
  );
}

async function sendPfAddressPage(ctx: Context, network: Network, plan: typeof PROP_PLANS[0]) {
  const coin = WALLET[network];
  const exactAmount = uniqueAmount(plan.price);
  const pending: PropFirmPending = {
    userId: ctx.from!.id,
    network,
    amount: exactAmount,
    baseAmount: plan.price,
    accountSize: plan.size,
    price: plan.price,
    timestamp: Date.now(),
  };
  await savePfPending(pending);
  await clearPfSizeStep(ctx.from!.id);

  await ctx.reply(
    `┌─────────────────────────┐\n` +
    `│  💳  SEND EXACT AMOUNT   │\n` +
    `└─────────────────────────┘\n\n` +
    `📊 *Package:* ${plan.label} (Both Phases)\n\n` +
    `To auto-detect your payment, send *exactly*:\n\n` +
    `┌─────────────────────────┐\n` +
    `│  💵  *${exactAmount.toFixed(2)} USDT*              │\n` +
    `└─────────────────────────┘\n\n` +
    `📬 *To:*\n\`${coin.address}\`\n\n` +
    `🌐 *Network:* ${coin.network}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚠️ The unique cents help us detect your payment automatically.\n\n` +
    `⏱ Payment window: *60 minutes*`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text(`📸 Show QR Code`, `pf_qr_${network}_${plan.tag}`).row()
        .text("✅ I've Sent It — Check Now", "pf_check").row()
        .text("❌ Cancel", "pf_cancel"),
    }
  );
}

async function handlePfCheckPayment(ctx: Context) {
  const userId = ctx.from!.id;
  const pending = await getPfPending(userId);

  if (!pending) {
    await ctx.reply(
      `⚠️ *No pending payment found.*\n\nIt may have expired (60 min limit).`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("🚀 New Order", "pf_new_order").row()
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
        .text("🔄 Try Again", "pf_check").row()
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
          .text("🔄 Check Again", "pf_check").row()
          .text("❌ Cancel", "pf_cancel"),
      }
    );
    return;
  }

  await removePfPending(userId);

  const plan = PROP_PLANS.find((p) => p.size === pending.accountSize)!;
  const orderId = newOrderId(userId);
  const name = ctx.from?.first_name ?? "User";
  const username = ctx.from?.username ? `@${ctx.from.username}` : "no username";

  const order: PropFirmOrder = {
    orderId,
    userId,
    userName: `${name} (${username})`,
    accountSize: pending.accountSize,
    price: pending.price,
    network: pending.network,
    exactAmount: pending.amount,
    txId: result.txId!,
    status: "payment_received",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await saveOrder(order);

  try {
    await ctx.api.sendMessage(
      process.env.ADMIN_CHANNEL_ID!,
      buildAdminOrderCard(order, order.userName) +
      `\n⚠️ <b>Awaiting account credentials from user.</b>`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("⚙️ Mark In Progress", `pf_inprogress_${orderId}`).row()
          .text("✅ Mark Completed", `pf_complete_${orderId}`).row()
          .text("❌ Mark Failed", `pf_fail_${orderId}`),
      }
    );
  } catch { }

  await ctx.reply(
    `╔═══════════════════════════╗\n` +
    `║  ✅  PAYMENT CONFIRMED!    ║\n` +
    `╚═══════════════════════════╝\n\n` +
    `🎉 *${pending.amount.toFixed(2)} USDT* received!\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📋 *Order ID:* \`${orderId}\`\n` +
    `🏆 *Package:* ${plan.label} (Both Phases)\n` +
    `📊 *Status:* Payment Confirmed\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `Now let's set up your account.\n` +
    `Please provide your trading account credentials so we can get started.`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("📝 Provide Account Details", `pf_start_creds_${orderId}`).row()
        .text("⏭ Skip for Now", "menu_propfirm"),
    }
  );

  await ctx.reply(buildPfReceipt(order), { parse_mode: "Markdown" });
}

async function askPfPlatform(ctx: Context) {
  await ctx.reply(
    `┌─────────────────────────┐\n` +
    `│  📝  ACCOUNT CREDENTIALS │\n` +
    `└─────────────────────────┘\n\n` +
    `*Step 1 of 4* ●○○○\n${"─".repeat(28)}\n\n` +
    `🖥 *Select your trading platform:*`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("MT4", "pf_cred_plat_MT4")
        .text("MT5", "pf_cred_plat_MT5").row()
        .text("❌ Cancel", "pf_cred_cancel"),
    }
  );
}

async function askPfBroker(ctx: Context) {
  await ctx.reply(
    `✅ *Platform selected!*\n\n` +
    `*Step 2 of 4* ●●○○\n${"─".repeat(28)}\n\n` +
    `🏦 *Enter your prop firm name and broker:*\n\n` +
    `_e.g._ FTMO, MyForexFunds, FundedNext, Topstep`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text("❌ Cancel", "pf_cred_cancel"),
    }
  );
}

async function askPfLogin(ctx: Context) {
  await ctx.reply(
    `✅ *Broker noted!*\n\n` +
    `*Step 3 of 4* ●●●○\n${"─".repeat(28)}\n\n` +
    `🔑 *Enter your account login number:*\n\n` +
    `_e.g._ \`12345678\``,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text("❌ Cancel", "pf_cred_cancel"),
    }
  );
}

async function askPfPasswordAndServer(ctx: Context) {
  await ctx.reply(
    `✅ *Login saved!*\n\n` +
    `*Step 4 of 4* ●●●●\n${"─".repeat(28)}\n\n` +
    `🔐 *Enter your account password:*\n\n` +
    `_This is your MT4/MT5 login password (not investor password)._`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text("❌ Cancel", "pf_cred_cancel"),
    }
  );
}

async function askPfServer(ctx: Context) {
  await ctx.reply(
    `✅ *Password saved!*\n\n` +
    `*Final Step* — Server Name\n${"─".repeat(28)}\n\n` +
    `🌐 *Enter your broker server name:*\n\n` +
    `_Exactly as shown in your MT4/MT5 login screen_\n` +
    `_e.g._ \`FTMOServer3\`, \`ICMarkets-Live01\``,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text("❌ Cancel", "pf_cred_cancel"),
    }
  );
}

async function finalizePfCredentials(ctx: Context, orderId: string, creds: PropFirmCredData) {
  const order = await getOrder(orderId);
  if (!order) return;

  const updated = await updateOrderStatus(orderId, "payment_received", {
    platform: creds.platform,
    broker: creds.broker,
    accountNumber: creds.accountNumber,
    serverName: creds.serverName,
  });
  if (!updated) return;

  try {
    await ctx.api.sendMessage(
      process.env.ADMIN_CHANNEL_ID!,
      `📋 <b>CREDENTIALS RECEIVED</b>\n\n` +
      buildAdminOrderCard(updated, updated.userName),
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("⚙️ Mark In Progress", `pf_inprogress_${orderId}`).row()
          .text("✅ Mark Completed", `pf_complete_${orderId}`).row()
          .text("❌ Mark Failed", `pf_fail_${orderId}`),
      }
    );
  } catch { }

  const plan = PROP_PLANS.find((p) => p.size === order.accountSize);

  await ctx.reply(
    `╔═══════════════════════════╗\n` +
    `║  ✅  SETUP COMPLETE!       ║\n` +
    `╚═══════════════════════════╝\n\n` +
    `Everything is set. Our traders will begin working on your account shortly.\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📋 *Order:* \`${orderId}\`\n` +
    `🏆 *Package:* ${plan?.label ?? "—"} (Both Phases)\n` +
    `🖥 *Platform:* ${creds.platform ?? "—"}\n` +
    `🏦 *Broker:* ${creds.broker ?? "—"}\n` +
    `🔑 *Login:* \`${creds.accountNumber ?? "—"}\`\n` +
    `🌐 *Server:* \`${creds.serverName ?? "—"}\`\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⏱ *Typical completion: 7–21 trading days*\n\n` +
    `You'll receive a notification when we move to Phase 2 and when both phases are passed. 🎉`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("📊 View Dashboard", "menu_propfirm").row()
        .text("🏠 Main Menu", "menu_main"),
    }
  );
}

export async function handlePropFirmTextInput(ctx: Context): Promise<boolean> {
  const userId = ctx.from!.id;
  const step = await getPfCredStep(userId);
  if (!step) return false;

  const text = (ctx.message as any)?.text?.trim() ?? "";
  if (!text || text.startsWith("/")) return false;

  const creds = await getPfCredData(userId);
  const orderId = await r().get<string>(`pf_cred_order:${userId}`);

  if (step === "broker") {
    creds.broker = text;
    await savePfCredData(userId, creds);
    await setPfCredStep(userId, "login");
    await askPfLogin(ctx);
    return true;
  }
  if (step === "login") {
    creds.accountNumber = text;
    await savePfCredData(userId, creds);
    await setPfCredStep(userId, "password");
    await askPfPasswordAndServer(ctx);
    return true;
  }
  if (step === "password") {
    creds.password = text;
    await savePfCredData(userId, creds);
    await setPfCredStep(userId, "server");
    await askPfServer(ctx);
    return true;
  }
  if (step === "server") {
    creds.serverName = text;
    await clearPfCredStep(userId);
    if (orderId) {
      await r().del(`pf_cred_order:${userId}`);
      await finalizePfCredentials(ctx, orderId, creds);
    }
    return true;
  }

  return false;
}

async function sendHowItWorks(ctx: Context) {
  await ctx.reply(
    `*🏆 How Prop Firm Challenge Passing Works*\n${"─".repeat(28)}\n\n` +
    `*Step 1 — Select Your Package*\nChoose your prop firm account size. All packages include both Phase 1 and Phase 2.\n\n` +
    `*Step 2 — Pay via USDT*\nSend payment to our secure wallet. We support TRC20 and ERC20 networks.\n\n` +
    `*Step 3 — Provide Account Details*\nShare your MT4/MT5 login credentials. Your funds are never touched — our team only trades.\n\n` +
    `*Step 4 — Our Team Gets to Work*\nOur expert traders begin Phase 1 immediately. Usually completed within 7–21 trading days.\n\n` +
    `*Step 5 — You Get the Funded Account*\nOnce both phases are passed, you receive full access to your funded account.\n\n` +
    `${"─".repeat(28)}\n` +
    `🛡 *Our Guarantee*\n` +
    `If we fail to pass both phases, we will refund or retry — no questions asked.\n\n` +
    `*Supported Firms:*\nFTMO · MyForexFunds · FundedNext · Topstep · The5%ers · E8 Markets · and more.`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("🚀 Place an Order", "pf_new_order").row()
        .text("🔙 Back to Dashboard", "menu_propfirm"),
    }
  );
}

async function sendMyOrders(ctx: Context) {
  const userId = ctx.from!.id;
  const orders = await getUserOrders(userId);

  if (orders.length === 0) {
    await ctx.reply(`📋 *No orders yet.*\n\nPlace your first challenge order to get started.`, {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("🚀 New Order", "pf_new_order").row()
        .text("🔙 Back", "menu_propfirm"),
    });
    return;
  }

  for (const o of orders.slice(0, 8)) {
    const plan = PROP_PLANS.find((p) => p.size === o.accountSize);
    const date = new Date(o.createdAt).toLocaleDateString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
    });
    const kb = new InlineKeyboard();
    if (o.status === "payment_received" && (!o.platform || !o.accountNumber)) {
      kb.text("📝 Provide Credentials", `pf_start_creds_${o.orderId}`).row();
    }
    await ctx.reply(
      `${statusEmoji(o.status)} *${plan?.label ?? formatSize(o.accountSize)}*  ·  \`${o.orderId}\`\n` +
      `📅 ${date}\n` +
      `📊 *Status:* ${statusLabel(o.status)}\n` +
      `💵 *Paid:* $${o.price}.00 USDT\n` +
      (o.broker ? `🏦 *Firm:* ${o.broker}\n` : ``) +
      (o.failReason ? `❌ *Reason:* _${o.failReason}_\n` : ``),
      { parse_mode: "Markdown", reply_markup: kb.inline_keyboard.length > 0 ? kb : undefined }
    );
  }

  await ctx.reply(`🏠 Return to dashboard:`, {
    reply_markup: new InlineKeyboard().text("🔙 Prop Firm Dashboard", "menu_propfirm"),
  });
}

export function registerPropFirmHandlers(bot: Bot<Context>): void {

  bot.callbackQuery("menu_propfirm", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendPropFirmDashboard(ctx);
  });

  bot.callbackQuery("pf_new_order", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendSizeSelector(ctx);
  });

  bot.callbackQuery(/^pf_size_(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const tag = ctx.match[1];
    const plan = PROP_PLANS.find((p) => p.tag === tag);
    if (!plan) { await ctx.reply("❌ Invalid plan. Please try again."); return; }
    await setPfSizeStep(ctx.from!.id, tag);
    await sendPfNetworkSelector(ctx, plan);
  });

  bot.callbackQuery(/^pf_net_(TRC20|ERC20)_(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const network = ctx.match[1] as Network;
    const tag = ctx.match[2];
    const plan = PROP_PLANS.find((p) => p.tag === tag);
    if (!plan) { await ctx.reply("❌ Invalid plan. Please try again."); return; }
    await sendPfAddressPage(ctx, network, plan);
  });

  bot.callbackQuery(/^pf_qr_(TRC20|ERC20)_(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery("Loading QR code...");
    const network = ctx.match[1] as Network;
    const tag = ctx.match[2];
    const plan = PROP_PLANS.find((p) => p.tag === tag);
    const pending = await getPfPending(ctx.from!.id);
    const coin = WALLET[network];
    await ctx.replyWithPhoto(coin.qrUrl, {
      caption:
        `📸 *${coin.label} QR Code*\n\n` +
        `🌐 Network: *${coin.network}*\n` +
        `💵 Send exactly: *${pending ? pending.amount.toFixed(2) : (plan?.price ?? 0).toFixed(2)} USDT*\n\n` +
        `Or copy address:\n\`${coin.address}\``,
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("✅ I've Sent It — Check Now", "pf_check").row()
        .text("❌ Cancel", "pf_cancel"),
    });
  });

  bot.callbackQuery("pf_check", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handlePfCheckPayment(ctx);
  });

  bot.callbackQuery("pf_cancel", async (ctx) => {
    await ctx.answerCallbackQuery("Cancelled");
    await removePfPending(ctx.from!.id);
    await clearPfSizeStep(ctx.from!.id);
    await ctx.reply(
      `❌ *Order cancelled.*`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("🚀 Try Again", "pf_new_order").row()
          .text("🏠 Main Menu", "menu_main"),
      }
    );
  });

  bot.callbackQuery(/^pf_start_creds_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const orderId = ctx.match[1];
    const userId = ctx.from!.id;
    await r().set(`pf_cred_order:${userId}`, orderId, { ex: 600 });
    await savePfCredData(userId, {});
    await setPfCredStep(userId, "platform");
    await askPfPlatform(ctx);
  });

  bot.callbackQuery(/^pf_cred_plat_(MT4|MT5)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const platform = ctx.match[1];
    const userId = ctx.from!.id;
    const creds = await getPfCredData(userId);
    creds.platform = platform;
    await savePfCredData(userId, creds);
    await setPfCredStep(userId, "broker");
    await askPfBroker(ctx);
  });

  bot.callbackQuery("pf_cred_cancel", async (ctx) => {
    await ctx.answerCallbackQuery("Cancelled");
    await clearPfCredStep(ctx.from!.id);
    await r().del(`pf_cred_order:${ctx.from!.id}`);
    await ctx.reply(
      `❌ *Credential entry cancelled.*\n\nYou can provide your account details later from the dashboard.`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("📊 My Orders", "pf_my_orders").row()
          .text("🏠 Main Menu", "menu_main"),
      }
    );
  });

  bot.callbackQuery("pf_how_it_works", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendHowItWorks(ctx);
  });

  bot.callbackQuery("pf_my_orders", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendMyOrders(ctx);
  });

  // ── ADMIN CALLBACKS ────────────────────────────────────────────────────────

  bot.callbackQuery(/^pf_inprogress_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isAdminChannel(ctx)) return;
    const orderId = ctx.match[1];
    const order = await updateOrderStatus(orderId, "in_progress");
    if (!order) { await ctx.reply(`⚠️ Order <code>${orderId}</code> not found.`, { parse_mode: "HTML" }); return; }

    try {
      await ctx.api.editMessageReplyMarkup(ctx.chat!.id, ctx.msgId, {
        reply_markup: new InlineKeyboard()
          .text("✅ Mark Completed", `pf_complete_${orderId}`).row()
          .text("❌ Mark Failed", `pf_fail_${orderId}`),
      });
    } catch { }

    try {
      await ctx.api.sendMessage(
        order.userId,
        `╔═══════════════════════════╗\n` +
        `║  ⚙️  ORDER IN PROGRESS     ║\n` +
        `╚═══════════════════════════╝\n\n` +
        `Great news! Our trading team has *started working* on your prop firm challenge.\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📋 *Order:* \`${orderId}\`\n` +
        `🏆 *Package:* ${formatSize(order.accountSize)} (Both Phases)\n\n` +
        `⏱ You will be notified when Phase 1 is passed and again when Phase 2 is complete.\n\n` +
        `_If you have any questions, contact support._`,
        {
          parse_mode: "Markdown",
          reply_markup: new InlineKeyboard()
            .text("📊 View Dashboard", "menu_propfirm").row()
            .text("💬 Support", "menu_support"),
        }
      );
    } catch { }

    await ctx.api.sendMessage(
      ctx.chat!.id,
      `✅ <b>Order marked In Progress</b>\n\n📋 <code>${orderId}</code>\n👤 User <code>${order.userId}</code> notified.`,
      { parse_mode: "HTML" }
    );
  });

  bot.callbackQuery(/^pf_complete_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isAdminChannel(ctx)) return;
    const orderId = ctx.match[1];
    const order = await updateOrderStatus(orderId, "completed");
    if (!order) { await ctx.reply(`⚠️ Order <code>${orderId}</code> not found.`, { parse_mode: "HTML" }); return; }

    try {
      await ctx.api.editMessageReplyMarkup(ctx.chat!.id, ctx.msgId, {
        reply_markup: new InlineKeyboard(),
      });
    } catch { }

    const plan = PROP_PLANS.find((p) => p.size === order.accountSize);

    try {
      await ctx.api.sendMessage(
        order.userId,
        `╔═══════════════════════════╗\n` +
        `║  🎉  CHALLENGE PASSED!     ║\n` +
        `╚═══════════════════════════╝\n\n` +
        `Congratulations! 🏆 Both phases of your prop firm challenge have been *successfully passed*!\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📋 *Order:* \`${orderId}\`\n` +
        `🏆 *Package:* ${plan?.label ?? formatSize(order.accountSize)}\n` +
        `✅ *Status:* BOTH PHASES PASSED\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💼 You now have access to your *fully funded account*.\n\n` +
        `Contact your prop firm to collect your login credentials for the funded account.\n\n` +
        `_Thank you for choosing Trading Flux!_ 🚀`,
        {
          parse_mode: "Markdown",
          reply_markup: new InlineKeyboard()
            .text("🏆 View Dashboard", "menu_propfirm").row()
            .text("🚀 Order Another", "pf_new_order").row()
            .text("🏠 Main Menu", "menu_main"),
        }
      );
    } catch { }

    await ctx.api.sendMessage(
      ctx.chat!.id,
      `✅ <b>Order Marked Completed</b>\n\n📋 <code>${orderId}</code>\n👤 User <code>${order.userId}</code> congratulated.`,
      { parse_mode: "HTML" }
    );
  });

  bot.callbackQuery(/^pf_fail_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isAdminChannel(ctx)) return;
    const orderId = ctx.match[1];
    const adminChatId = ctx.chat!.id.toString();
    await setPfFailStep(adminChatId, orderId);
    await ctx.reply(
      `✍️ <b>Failure Reason</b>\n\n` +
      `Type the reason for failing order <code>${orderId}</code>.\n\n` +
      `This message will be sent to the user. Send <code>/cancel_pf_fail</code> to abort.`,
      { parse_mode: "HTML" }
    );
  });

  bot.command("pforders", async (ctx) => {
    if (!isAdminChannel(ctx)) return;
    const allIds = await r().smembers("pf_all_orders");
    if (!allIds || allIds.length === 0) {
      await ctx.api.sendMessage(ctx.chat!.id, `📋 <b>No prop firm orders yet.</b>`, { parse_mode: "HTML" });
      return;
    }
    const orders = (await Promise.all(allIds.map(getOrder))).filter(Boolean) as PropFirmOrder[];
    const active = orders.filter((o) => o.status !== "completed" && o.status !== "failed");
    const completed = orders.filter((o) => o.status === "completed");

    await ctx.api.sendMessage(
      ctx.chat!.id,
      `╔═══════════════════════════╗\n` +
      `║  📋  PROP FIRM ORDERS      ║\n` +
      `╚═══════════════════════════╝\n\n` +
      `<b>Total:</b> ${orders.length}   <b>Active:</b> ${active.length}   <b>Completed:</b> ${completed.length}`,
      { parse_mode: "HTML" }
    );

    for (const o of active.slice(0, 10)) {
      await ctx.api.sendMessage(
        ctx.chat!.id,
        buildAdminOrderCard(o, o.userName),
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text("⚙️ In Progress", `pf_inprogress_${o.orderId}`).row()
            .text("✅ Complete", `pf_complete_${o.orderId}`)
            .text("❌ Fail", `pf_fail_${o.orderId}`),
        }
      );
    }
  });

  bot.command("cancel_pf_fail", async (ctx) => {
    if (!isAdminChannel(ctx)) return;
    await clearPfFailStep(ctx.chat!.id.toString());
    await ctx.api.sendMessage(ctx.chat!.id, `✅ Failure entry cancelled.`);
  });

  // ── Admin text handler: captures fail reason ───────────────────────────────
  bot.on(["message:text", "channel_post:text"], async (ctx, next) => {
    const adminChannelId = process.env.ADMIN_CHANNEL_ID;
    const chatId = ctx.chat?.id?.toString();
    if (!adminChannelId || chatId !== adminChannelId) { await next(); return; }

    const text = ((ctx.message as any)?.text ?? (ctx as any).channelPost?.text ?? "").trim();
    if (!text || text.startsWith("/")) { await next(); return; }

    const failOrderId = await getPfFailStep(chatId);
    if (!failOrderId) { await next(); return; }

    await clearPfFailStep(chatId);
    const order = await updateOrderStatus(failOrderId, "failed", { failReason: text });
    if (!order) {
      await ctx.api.sendMessage(ctx.chat!.id, `⚠️ Order not found: <code>${failOrderId}</code>`, { parse_mode: "HTML" });
      return;
    }

    try {
      await ctx.api.sendMessage(
        order.userId,
        `╔═══════════════════════════╗\n` +
        `║  ❌  ORDER UPDATE          ║\n` +
        `╚═══════════════════════════╝\n\n` +
        `Hi, we encountered an issue with your prop firm challenge order.\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📋 *Order:* \`${failOrderId}\`\n` +
        `🏆 *Package:* ${formatSize(order.accountSize)}\n\n` +
        `📋 *Update:*\n_${text}_\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Please contact support for next steps.`,
        {
          parse_mode: "Markdown",
          reply_markup: new InlineKeyboard()
            .text("💬 Contact Support", "menu_support").row()
            .text("📊 Dashboard", "menu_propfirm"),
        }
      );
    } catch { }

    await ctx.api.sendMessage(
      ctx.chat!.id,
      `✅ <b>Order marked Failed</b>\n\n📋 <code>${failOrderId}</code>\n👤 User <code>${order.userId}</code> notified.\n\n<b>Reason:</b> ${text}`,
      { parse_mode: "HTML" }
    );
  });
}
