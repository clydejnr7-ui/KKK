import { Bot, Context } from "grammy";
import { registerFormHandlers } from "./handlers/form";
import { registerApproveHandler } from "./handlers/approve";
import { registerBalanceHandler } from "./handlers/balance";
import { registerDepositHandlers } from "./handlers/deposit";
import { registerSupportHandlers } from "./handlers/support";
import { registerNotifyHandlers } from "./handlers/notify";
import { registerPropFirmHandlers } from "./handlers/propfirm";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");

export const bot = new Bot<Context>(token);

// Register prop firm FIRST so its admin text handler (fail reason capture)
// runs before the generic support admin text handler
registerPropFirmHandlers(bot);

registerApproveHandler(bot);
registerNotifyHandlers(bot);
registerFormHandlers(bot);
registerBalanceHandler(bot);
registerDepositHandlers(bot);
registerSupportHandlers(bot);
