import "dotenv/config";
import { Bot } from "grammy";
import { registerFormHandlers } from "./handlers/form";
import { registerBalanceHandler } from "./handlers/balance";
import { registerDepositHandlers } from "./handlers/deposit";
import { registerApproveHandler } from "./handlers/approve";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is not set in environment variables.");
}

export const bot = new Bot(token);

// Register all handlers
// approve first (admin channel commands, very specific match)
registerApproveHandler(bot);
// deposit before form so deposit text input takes priority over form steps
registerDepositHandlers(bot);
registerBalanceHandler(bot);
registerFormHandlers(bot);

// Error handler
bot.catch((err) => {
  console.error("Bot error:", err);
});

// Start polling (for local dev / GitHub Actions runner)
if (require.main === module) {
  bot.start({
    onStart: (info) => {
      console.log(`Trading Flux Bot (@${info.username}) is running...`);
    },
  });
}

export default bot;
