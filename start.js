const bot = require('./bot');

bot.launch().then(() => {
    console.log("🚀 CONTENT BOT is running locally...");
}).catch(err => {
    console.error("Bot launch error:", err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
