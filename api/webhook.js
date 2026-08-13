const bot = require('../bot');

module.exports = async (req, res) => {
    try {
        await bot.handleUpdate(req.body, res);
    } catch (e) {
        console.error("Webhook error:", e);
        res.status(500).send("Error");
    }
};
