import { Bot, Context } from "grammy";
import { registerFormHandlers } from "./handlers/form";
import { registerApproveHandler } from "./handlers/approve";
import { registerBalanceHandler } from "./handlers/balance";
import { registerDepositHandlers } from "./handlers/deposit";
import { registerSupportHandlers } from "./handlers/support";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");

export const bot = new Bot<Context>(token);

registerApproveHandler(bot);   // ← must be first so admin text isn't swallowed by form handler
registerFormHandlers(bot);
registerBalanceHandler(bot);
registerDepositHandlers(bot);
registerSupportHandlers(bot);
