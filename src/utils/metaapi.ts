// MetaAPI integration — connects to real MT4/MT5 broker accounts
// Sign up for a free token at: https://metaapi.cloud
// Free tier: 2 provisioned accounts. Upgrade for production scale.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const MetaApi = require("metaapi.cloud-sdk").default;

import { LiveBalance } from "./balance";

export interface ConnectResult {
  success: boolean;
  metaApiAccountId?: string;
  balance?: LiveBalance;
  error?: string;
}

export interface AccountCredentials {
  userId: number;
  accountNumber: string;
  password: string;
  investorPassword?: string;
  serverName: string;
  platform: "MT4" | "MT5";
}

// ── Balance cache (60s TTL) to avoid hammering MetaAPI on every /balance tap ──
const balanceCache = new Map<string, LiveBalance>();

function getCached(metaApiAccountId: string): LiveBalance | null {
  const cached = balanceCache.get(metaApiAccountId);
  if (!cached) return null;
  const age = Date.now() - cached.lastUpdated.getTime();
  return age < 60_000 ? cached : null;
}

function setCache(metaApiAccountId: string, balance: LiveBalance): void {
  balanceCache.set(metaApiAccountId, balance);
}

function getApi(): InstanceType<typeof MetaApi> | null {
  const token = process.env.META_API_TOKEN;
  if (!token) return null;
  return new MetaApi(token);
}

// ── Initial validation (called on admin /approve) ─────────────────────────────
// Can take up to 90s on first connection. Admin is shown a "verifying..." message.
export async function connectAndValidate(
  creds: AccountCredentials
): Promise<ConnectResult> {
  const api = getApi();
  if (!api) {
    return { success: false, error: "META_API_TOKEN is not configured in environment secrets." };
  }

  const accountName = `TradingFlux-${creds.userId}`;
  // Use investor password (read-only) for safety; fall back to main password
  const loginPassword = creds.investorPassword?.trim() || creds.password;

  let account: any;
  try {
    // Reuse existing provisioned account if present
    const all = await api.metatraderAccountApi.getAccountsWithInfiniteScrollPagination();
    const found = all.find((a: any) => a.name === accountName);

    if (found) {
      account = found;
    } else {
      account = await api.metatraderAccountApi.createAccount({
        name: accountName,
        type: "cloud",
        login: creds.accountNumber,
        password: loginPassword,
        server: creds.serverName,
        platform: creds.platform.toLowerCase() as "mt4" | "mt5",
        magic: 0,
      });
    }
  } catch (err: any) {
    return { success: false, error: parseError(err) };
  }

  try {
    if (!["DEPLOYED", "DEPLOYING"].includes(account.state)) {
      await account.deploy();
    }
    await account.waitConnected({ timeoutInSeconds: 90 });

    const conn = account.getRPCConnection();
    await conn.connect();
    await conn.waitSynchronized({ timeoutInSeconds: 30 });

    const info = await conn.getAccountInformation();
    await conn.close();

    const live: LiveBalance = {
      balance: info.balance,
      equity: info.equity,
      openProfit: info.equity - info.balance,
      currency: info.currency,
      leverage: info.leverage,
      lastUpdated: new Date(),
      server: creds.serverName,
    };

    setCache(account.id, live);

    return { success: true, metaApiAccountId: account.id, balance: live };
  } catch (err: any) {
    // Remove the account if it was freshly created and failed to connect
    try { await account.undeploy(); } catch { /* ignore */ }
    return { success: false, error: parseError(err) };
  }
}

// ── Fetch live balance for an already-provisioned account ─────────────────────
export async function fetchLiveBalance(
  metaApiAccountId: string,
  serverName?: string
): Promise<LiveBalance | null> {
  const cached = getCached(metaApiAccountId);
  if (cached) return cached;

  const api = getApi();
  if (!api) return null;

  try {
    const account = await api.metatraderAccountApi.getAccount(metaApiAccountId);

    if (account.connectionStatus !== "CONNECTED") {
      await account.waitConnected({ timeoutInSeconds: 20 });
    }

    const conn = account.getRPCConnection();
    await conn.connect();
    await conn.waitSynchronized({ timeoutInSeconds: 15 });
    const info = await conn.getAccountInformation();
    await conn.close();

    const live: LiveBalance = {
      balance: info.balance,
      equity: info.equity,
      openProfit: info.equity - info.balance,
      currency: info.currency,
      leverage: info.leverage,
      lastUpdated: new Date(),
      server: serverName,
    };
    setCache(metaApiAccountId, live);
    return live;
  } catch {
    return null;
  }
}

// ── Parse MetaAPI error messages into human-readable form ─────────────────────
function parseError(err: any): string {
  const msg: string = err?.message ?? String(err);
  if (
    msg.includes("INVALID_CREDENTIALS") ||
    msg.includes("NotAuthenticated") ||
    msg.includes("invalid login") ||
    msg.includes("InvalidLogin") ||
    msg.includes("wrong password")
  ) {
    return "Invalid credentials — login, password, or investor password is incorrect.";
  }
  if (msg.includes("server") || msg.includes("Server")) {
    return "Invalid server name — check broker server (e.g. ICMarkets-Live).";
  }
  if (msg.includes("timeout") || msg.includes("Timeout")) {
    return "Connection timed out — broker server may be unreachable. Verify server name and platform (MT4 vs MT5).";
  }
  return `Broker error: ${msg.slice(0, 200)}`;
}
