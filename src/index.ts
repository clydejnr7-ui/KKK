import {
  handleDepositStart,
  handleNetworkSelected,
  handleDepositTextInput,
  creditDeposit,
} from "./handlers/deposit";

// In your bot setup:
bot.callbackQuery("menu_deposit", async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleDepositStart(ctx);
});

bot.callbackQuery("deposit_net_TRC20", async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleNetworkSelected(ctx, "TRC20");
});

bot.callbackQuery("deposit_net_ERC20", async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleNetworkSelected(ctx, "ERC20");
});

bot.callbackQuery("deposit_check", async (ctx) => {
  await ctx.answerCallbackQuery();
  await creditDeposit(ctx);
});

bot.callbackQuery("deposit_cancel", async (ctx) => {
  await ctx.answerCallbackQuery("Cancelled");
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  await redis.del(`deposit_step:${ctx.from!.id}`);
  await redis.del(`deposit:${ctx.from!.id}`);
  await ctx.reply("❌ Deposit cancelled.", {
    reply_markup: new InlineKeyboard().text("🏠 Main Menu", "menu_main"),
  });
});
