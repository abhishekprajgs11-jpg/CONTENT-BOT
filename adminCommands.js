const { Markup } = require('telegraf');
const User = require('./models/User');
const Batch = require('./models/Batch');
const MediaItem = require('./models/MediaItem');
const AccessRequest = require('./models/AccessRequest');
const State = require('./models/State');

const ADMIN_ID = process.env.ADMIN_ID;

module.exports = (bot) => {

    // -----------------------------------------------------
    // ADMIN DASHBOARD & REQUEST MANAGEMENT (/request)
    // -----------------------------------------------------
    bot.command('request', async (ctx) => {
        if (ctx.from.id.toString() !== ADMIN_ID) {
            return ctx.reply("❌ Only the Main Bot Admin can access request management.");
        }

        const pendingReqs = await AccessRequest.find({ status: 'PENDING' });
        const grantedReqs = await AccessRequest.find({ status: 'GRANTED' });
        const deniedReqs = await AccessRequest.find({ status: 'DENIED' });

        const text = `⚙️ **ADMIN REQUEST MANAGEMENT DASHBOARD**\n\n` +
                     `⏳ **Pending Requests:** ${pendingReqs.length}\n` +
                     `✅ **Granted Requests:** ${grantedReqs.length}\n` +
                     `❌ **Denied Requests:** ${deniedReqs.length}\n\n` +
                     `Select what you want to manage:`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback(`⏳ View Pending (${pendingReqs.length})`, "view_req_PENDING")],
            [Markup.button.callback(`✅ View Granted (${grantedReqs.length})`, "view_req_GRANTED")],
            [Markup.button.callback(`❌ View Denied (${deniedReqs.length})`, "view_req_DENIED")]
        ]);

        ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard.reply_markup });
    });

    // Handle Viewing Requests by Status
    bot.action(/^view_req_(.+)$/, async (ctx) => {
        if (ctx.from.id.toString() !== ADMIN_ID) return;
        const status = ctx.match[1];

        const requests = await AccessRequest.find({ status }).populate('requestedBatches').limit(15);
        if (requests.length === 0) {
            return ctx.editMessageText(`No **${status}** requests found.`, {
                reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Back to Admin Dashboard", "admin_dashboard_home")]]).reply_markup
            });
        }

        let msgText = `📋 **${status} REQUESTS (Last ${requests.length}):**\n\n`;
        const buttons = [];

        requests.forEach((req, idx) => {
            const batchNames = req.requestedBatches.map(b => b.name).join(', ') || 'N/A';
            const typeStr = req.requestType === 'ADD_BATCH' ? '➕ Add Batch Perms' : `📂 Batches: ${batchNames}`;
            msgText += `**${idx + 1}.** User: **${req.userName}** (\`${req.userId}\`)\n` +
                       `📌 Type: ${typeStr}\n` +
                       `📅 Date: ${req.createdAt.toLocaleString()}\n\n`;

            if (status === 'PENDING') {
                buttons.push([
                    Markup.button.callback(`✅ Approve ${req.userName.substring(0, 10)}`, `approve_req_${req._id}`),
                    Markup.button.callback(`❌ Deny ${req.userName.substring(0, 10)}`, `deny_req_${req._id}`)
                ]);
            }
        });

        buttons.push([Markup.button.callback("⬅️ Back to Admin Dashboard", "admin_dashboard_home")]);

        ctx.editMessageText(msgText, { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard(buttons).reply_markup });
    });

    bot.action("admin_dashboard_home", async (ctx) => {
        if (ctx.from.id.toString() !== ADMIN_ID) return;

        const pendingReqs = await AccessRequest.find({ status: 'PENDING' });
        const grantedReqs = await AccessRequest.find({ status: 'GRANTED' });
        const deniedReqs = await AccessRequest.find({ status: 'DENIED' });

        const text = `⚙️ **ADMIN REQUEST MANAGEMENT DASHBOARD**\n\n` +
                     `⏳ **Pending Requests:** ${pendingReqs.length}\n` +
                     `✅ **Granted Requests:** ${grantedReqs.length}\n` +
                     `❌ **Denied Requests:** ${deniedReqs.length}\n\n` +
                     `Select what you want to manage:`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback(`⏳ View Pending (${pendingReqs.length})`, "view_req_PENDING")],
            [Markup.button.callback(`✅ View Granted (${grantedReqs.length})`, "view_req_GRANTED")],
            [Markup.button.callback(`❌ View Denied (${deniedReqs.length})`, "view_req_DENIED")]
        ]);

        ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard.reply_markup });
    });

    // -----------------------------------------------------
    // APPROVE & DENY HANDLERS (Inline Actions)
    // -----------------------------------------------------
    bot.action(/^approve_req_(.+)$/, async (ctx) => {
        if (ctx.from.id.toString() !== ADMIN_ID) return;
        const reqId = ctx.match[1];

        const req = await AccessRequest.findById(reqId).populate('requestedBatches');
        if (!req) return ctx.answerCbQuery("Request not found!");

        req.status = 'GRANTED';
        await req.save();

        let user = await User.findOne({ telegramId: req.userId });
        if (!user) {
            user = new User({ telegramId: req.userId, name: req.userName, username: req.userUsername });
        }

        if (req.requestType === 'ADD_BATCH') {
            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback("1 Batch", `limit_req_${req._id}_1`), Markup.button.callback("3 Batches", `limit_req_${req._id}_3`)],
                [Markup.button.callback("5 Batches", `limit_req_${req._id}_5`), Markup.button.callback("10 Batches", `limit_req_${req._id}_10`)],
                [Markup.button.callback("♾️ Unlimited Batches", `limit_req_${req._id}_999999`)]
            ]);

            return ctx.editMessageText(
                `⚙️ **SELECT BATCH CREATION LIMIT**\n\nHow many batches is **${req.userName}** (\`${req.userId}\`) allowed to create/add?`,
                { parse_mode: 'Markdown', reply_markup: keyboard.reply_markup }
            );
        } else if (req.requestType === 'BATCH_ACCESS') {
            const newBatches = req.requestedBatches.map(b => b._id);
            user.allowedBatches = [...new Set([...user.allowedBatches.map(b => b.toString()), ...newBatches.map(b => b.toString())])];
            await user.save();

            const batchNames = req.requestedBatches.map(b => b.name).join('\n• ');
            ctx.answerCbQuery("Access granted for batch(es)!");
            ctx.editMessageText(`✅ **GRANTED**: User **${req.userName}** (\`${req.userId}\`) now has access to:\n\n• ${batchNames}`, { parse_mode: 'Markdown' });

            // Notify user
            try {
                await bot.telegram.sendMessage(
                    req.userId,
                    `🎉 **ACCESS GRANTED!**\n\nAdmin has approved your request for the following batch(es):\n\n• ${batchNames}\n\n👉 Type /mybatches to view and download files!`,
                    { parse_mode: 'Markdown' }
                );
            } catch (e) { console.error("Could not notify user:", e); }
        }
    });

    bot.action(/^limit_req_(.+)_(.+)$/, async (ctx) => {
        if (ctx.from.id.toString() !== ADMIN_ID) return;
        const reqId = ctx.match[1];
        const limitStr = ctx.match[2];
        const limit = parseInt(limitStr, 10);

        const req = await AccessRequest.findById(reqId);
        if (!req) return ctx.answerCbQuery("Request not found!");

        req.status = 'GRANTED';
        await req.save();

        let user = await User.findOne({ telegramId: req.userId });
        if (!user) {
            user = new User({ telegramId: req.userId, name: req.userName, username: req.userUsername });
        }

        user.isAddAuthorized = true;
        if (user.role === 'USER') user.role = 'CONTRIBUTOR';

        if (limit === 999999) {
            user.maxBatchesAllowed = 999999;
        } else {
            // Add to existing capacity or set limit
            user.maxBatchesAllowed = Math.max(user.maxBatchesAllowed, user.batchesCreatedCount) + limit;
        }
        await user.save();

        const limitDisplay = limit === 999999 ? 'Unlimited' : `${limit} new`;
        const totalAllowedDisplay = user.maxBatchesAllowed >= 999999 ? 'Unlimited' : `${user.maxBatchesAllowed}`;

        ctx.answerCbQuery("Batch limit authorized!");
        ctx.editMessageText(
            `✅ **GRANTED**: User **${req.userName}** (\`${req.userId}\`) is authorized to add **${limitDisplay}** batch(es)!\n` +
            `📊 Total Allowed: **${totalAllowedDisplay}** | Created so far: **${user.batchesCreatedCount}**`,
            { parse_mode: 'Markdown' }
        );

        // Notify user
        try {
            await bot.telegram.sendMessage(
                req.userId,
                `🎉 **PERMIT GRANTED!**\n\n` +
                `Admin has authorized you to create **${limitDisplay}** batch(es)!\n` +
                `📌 Total Authorized Limit: **${totalAllowedDisplay}** batch(es).\n\n` +
                `👉 Type /add to start creating batches.`
            );
        } catch (e) { console.error("Could not notify user:", e); }
    });

    bot.action(/^deny_req_(.+)$/, async (ctx) => {
        if (ctx.from.id.toString() !== ADMIN_ID) return;
        const reqId = ctx.match[1];

        const req = await AccessRequest.findById(reqId);
        if (!req) return ctx.answerCbQuery("Request not found!");

        req.status = 'DENIED';
        await req.save();

        ctx.answerCbQuery("Request Denied!");
        ctx.editMessageText(`❌ **DENIED**: Request from user **${req.userName}** (\`${req.userId}\`) was denied.`, { parse_mode: 'Markdown' });

        // Notify user
        try {
            await bot.telegram.sendMessage(
                req.userId,
                `❌ **Request Update:** Your access request was not approved by the admin.`
            );
        } catch (e) { console.error("Could not notify user:", e); }
    });

    // -----------------------------------------------------
    // ADMIN DELETE BATCH (/delbatch)
    // -----------------------------------------------------
    bot.command('delbatch', async (ctx) => {
        if (ctx.from.id.toString() !== ADMIN_ID) {
            return ctx.reply("❌ Only Main Admin can delete batches.");
        }

        const batches = await Batch.find({});
        if (batches.length === 0) return ctx.reply("No batches exist to delete.");

        const buttons = batches.map(b => [Markup.button.callback(`🗑️ Delete: ${b.name}`, `confirm_delbatch_${b._id}`)]);
        buttons.push([Markup.button.callback("❌ Cancel", "cancel_admin_action")]);

        ctx.reply("⚠️ **Select a Batch to DELETE:**\n(This will delete all videos and files in this batch)", { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard(buttons).reply_markup });
    });

    bot.action(/^confirm_delbatch_(.+)$/, async (ctx) => {
        if (ctx.from.id.toString() !== ADMIN_ID) return;
        const batchId = ctx.match[1];

        const batch = await Batch.findById(batchId);
        if (!batch) return ctx.answerCbQuery("Batch not found!");

        await MediaItem.deleteMany({ batchId });
        await Batch.findByIdAndDelete(batchId);

        // Remove from allowedBatches of all users
        await User.updateMany({}, { $pull: { allowedBatches: batchId } });

        ctx.editMessageText(`✅ Batch **${batch.name}** and all its media files have been deleted successfully.`, { parse_mode: 'Markdown' });
    });

    bot.action("cancel_admin_action", async (ctx) => {
        ctx.editMessageText("Cancelled.");
    });
};
