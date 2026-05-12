import { Bot, Context } from "grammy";
import { registerFormHandlers } from "./handlers/form";
import { registerApproveHandler } from "./handlers/approve";
import { registerBalanceHandler } from "./handlers/balance";
import { registerDepositHandlers } from "./handlers/deposit";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");

export const bot = new Bot<Context>(token);

// Register all handlers
registerFormHandlers(bot);
registerApproveHandler(bot);
registerBalanceHandler(bot);
registerDepositHandlers(bot);
