const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const User = require('./models/User');
const Batch = require('./models/Batch');
const MediaItem = require('./models/MediaItem');
const AccessRequest = require('./models/AccessRequest');
const State = require('./models/State');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = process.env.ADMIN_ID;

const CATEGORIES = ['OPTIONAL', 'GS', 'MATHEMATICS', 'MAINS', 'PRELIMS', 'MISCELLANEOUS'];

const connectDB = async () => {
    if (mongoose.connection.readyState >= 1) return;
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000 
        });
        console.log("MongoDB Connected");
    } catch (error) {
        console.error("MongoDB Connection Error:", error);
        throw error;
    }
};

bot.use(async (ctx, next) => {
    try {
        await connectDB();
        
        if (ctx.from) {
            const userId = ctx.from.id.toString();
            const name = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || 'User';
            const username = ctx.from.username || '';

            let user = await User.findOne({ telegramId: userId });
            if (!user) {
                const isAdmin = userId === ADMIN_ID;
                user = new User({
                    telegramId: userId,
                    name,
                    username,
                    role: isAdmin ? 'ADMIN' : 'USER',
                    isAddAuthorized: isAdmin
                });
                await user.save();
            }
        }
        return next();
    } catch (err) {
        console.error("Middleware Error:", err);
        if (ctx.chat) {
            await ctx.reply("Database is temporarily unavailable. Please try again later.");
        }
    }
});

// -----------------------------------------------------
// USER COMMANDS: /start, /help, /cancel, /done
// -----------------------------------------------------

bot.start(async (ctx) => {
    const welcomeText = `🎯 **WELCOME TO CONTENT BOT** 📚\n\n` +
                        `Welcome, ${ctx.from.first_name}! 👋\n` +
                        `Ye bot aapko different study Batches ke Videos aur Files exact sequence aur format mein provide karta hai.\n\n` +
                        `📌 **Available Commands & Features:**\n` +
                        `👉 /mybatches - View and download your authorized batch files\n` +
                        `👉 /demand - Request access for new Batches\n` +
                        `👉 /add - Create & upload a new Batch (Requires Contributor authorization)\n\n` +
                        `💡 Choose an option below to start:`;

    const isMainAdmin = ctx.from.id.toString() === ADMIN_ID;

    const keyboardButtons = [
        [Markup.button.callback("📂 My Authorized Batches", "nav_mybatches")],
        [Markup.button.callback("📝 Request Batch Access (/demand)", "nav_demand")],
        [Markup.button.callback("➕ Create & Upload Batch (/add)", "nav_add")]
    ];

    if (isMainAdmin) {
        keyboardButtons.push([Markup.button.callback("⚙️ Admin Dashboard (/request)", "nav_admin")]);
    }

    ctx.reply(welcomeText, { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard(keyboardButtons).reply_markup });
});

bot.command(['cancel', 'stopupload', 'done'], async (ctx) => {
    const userId = ctx.from.id.toString();
    const state = await State.findOne({ userId });

    if (state && state.step === 'UPLOADING_MEDIA') {
        const count = await MediaItem.countDocuments({ batchId: state.batchId });
        await State.findOneAndDelete({ userId });
        return ctx.reply(`🎉 **Batch Upload Completed!**\n\nTotal files/videos uploaded: **${count}**.\nIt is now saved in the bot!`, { parse_mode: 'Markdown' });
    }

    await State.findOneAndDelete({ userId });
    ctx.reply("❌ Operation cancelled.");
});

bot.action("nav_mybatches", async (ctx) => ctx.reply("👉 Type /mybatches to view your batches."));
bot.action("nav_demand", async (ctx) => ctx.reply("👉 Type /demand to request batch access."));
bot.action("nav_add", async (ctx) => ctx.reply("👉 Type /add to start batch creation wizard."));
bot.action("nav_admin", async (ctx) => ctx.reply("👉 Type /request to open Admin Dashboard."));


// -----------------------------------------------------
// BATCH CREATION & MEDIA UPLOAD FLOW (/add)
// -----------------------------------------------------

bot.command('add', async (ctx) => {
    const userId = ctx.from.id.toString();
    const user = await User.findOne({ telegramId: userId });

    const isMainAdmin = userId === ADMIN_ID;

    if (!isMainAdmin) {
        if (!user || !user.isAddAuthorized) {
            // Request authorization from Main Admin
            const existingReq = await AccessRequest.findOne({ userId, requestType: 'ADD_BATCH', status: 'PENDING' });
            if (existingReq) {
                return ctx.reply("⏳ Your request for Batch Add permission is already pending admin approval.");
            }

            const newReq = new AccessRequest({
                userId,
                userName: `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || 'User',
                userUsername: ctx.from.username || '',
                requestType: 'ADD_BATCH',
                status: 'PENDING'
            });
            await newReq.save();

            ctx.reply("🔒 **AUTHORIZATION REQUIRED**\n\nYou do not have permission to add batches yet. A permission request has been sent to the Admin. You will be notified once approved!", { parse_mode: 'Markdown' });

            // Alert Main Admin
            try {
                await bot.telegram.sendMessage(
                    ADMIN_ID,
                    `📩 **NEW BATCH ADD PERMISSION REQUEST**\n\n` +
                    `👤 User: **${newReq.userName}** (@${newReq.userUsername})\n` +
                    `🆔 User ID: \`${userId}\`\n\n` +
                    `This user wants authorization to add and upload new batches.`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: Markup.inlineKeyboard([
                            [
                                Markup.button.callback("✅ Grant Permission", `approve_req_${newReq._id}`),
                                Markup.button.callback("❌ Deny", `deny_req_${newReq._id}`)
                            ]
                        ]).reply_markup
                    }
                );
            } catch (e) { console.error("Could not send admin alert:", e); }
            return;
        }

        // Check if contributor reached their batch limit
        if (user.batchesCreatedCount >= user.maxBatchesAllowed) {
            const limitDisplay = user.maxBatchesAllowed >= 999999 ? 'Unlimited' : user.maxBatchesAllowed;

            const existingReq = await AccessRequest.findOne({ userId, requestType: 'ADD_BATCH', status: 'PENDING' });
            if (existingReq) {
                return ctx.reply(
                    `⚠️ **BATCH CREATION LIMIT REACHED**\n\n` +
                    `You have created **${user.batchesCreatedCount}** / **${limitDisplay}** authorized batches.\n` +
                    `⏳ Your request for additional batch capacity is currently pending admin approval.`,
                    { parse_mode: 'Markdown' }
                );
            }

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback("📩 Request More Batch Capacity", "req_more_batches")]
            ]);

            return ctx.reply(
                `⚠️ **BATCH CREATION LIMIT REACHED**\n\n` +
                `You have created **${user.batchesCreatedCount}** out of **${limitDisplay}** authorized batches.\n\n` +
                `Click below to request additional batch creation authorization from the Admin!`,
                { parse_mode: 'Markdown', reply_markup: keyboard.reply_markup }
            );
        }
    }

    // Authorized User: Start Batch Wizard
    await State.findOneAndUpdate(
        { userId },
        { step: 'SELECT_CATEGORY', category: null, batchId: null, mediaCount: 0 },
        { upsert: true }
    );

    const categoryButtons = CATEGORIES.map(cat => Markup.button.callback(cat, `add_cat_${cat}`));
    const keyboard = Markup.inlineKeyboard(categoryButtons, { columns: 2 });

    ctx.reply("➕ **CREATE NEW BATCH**\n\nPlease select the **Category** for this batch:", { parse_mode: 'Markdown', reply_markup: keyboard.reply_markup });
});

bot.action("req_more_batches", async (ctx) => {
    const userId = ctx.from.id.toString();
    const user = await User.findOne({ telegramId: userId });

    const existingReq = await AccessRequest.findOne({ userId, requestType: 'ADD_BATCH', status: 'PENDING' });
    if (existingReq) {
        return ctx.answerCbQuery("Request already pending admin approval!");
    }

    const newReq = new AccessRequest({
        userId,
        userName: `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || 'User',
        userUsername: ctx.from.username || '',
        requestType: 'ADD_BATCH',
        status: 'PENDING'
    });
    await newReq.save();

    ctx.answerCbQuery("Request sent to Admin!");
    ctx.editMessageText(
        `✅ **REQUEST SENT**\n\nYour request for additional batch creation limit has been sent to the Admin!`,
        { parse_mode: 'Markdown' }
    );

    // Alert Main Admin
    try {
        await bot.telegram.sendMessage(
            ADMIN_ID,
            `📩 **MORE BATCH CAPACITY REQUEST**\n\n` +
            `👤 User: **${newReq.userName}** (@${newReq.userUsername})\n` +
            `🆔 User ID: \`${userId}\`\n` +
            `📊 Batches Created: **${user ? user.batchesCreatedCount : 0}** / **${user ? user.maxBatchesAllowed : 0}**\n\n` +
            `This user wants additional batch creation capacity.`,
            {
                parse_mode: 'Markdown',
                reply_markup: Markup.inlineKeyboard([
                    [
                        Markup.button.callback("✅ Set/Increase Limit", `approve_req_${newReq._id}`),
                        Markup.button.callback("❌ Deny", `deny_req_${newReq._id}`)
                    ]
                ]).reply_markup
            }
        );
    } catch (e) { console.error("Could not send admin alert:", e); }
});

bot.action(/^add_cat_(.+)$/, async (ctx) => {
    const category = ctx.match[1];
    const userId = ctx.from.id.toString();

    await State.findOneAndUpdate({ userId }, { category, step: 'WAITING_BATCH_NAME' });
    ctx.editMessageText(`Selected Category: **${category}**\n\nPlease type the **Batch Name** (e.g. Vision GS 2026, Maths Optional 2025):`, { parse_mode: 'Markdown' });
});


// -----------------------------------------------------
// ACCESS REQUEST FLOW (/demand)
// -----------------------------------------------------

bot.command('demand', async (ctx) => {
    const userId = ctx.from.id.toString();

    await State.findOneAndUpdate(
        { userId },
        { step: 'DEMAND_SELECT_CATEGORY', selectedBatches: [] },
        { upsert: true }
    );

    const categoryButtons = CATEGORIES.map(cat => Markup.button.callback(cat, `demand_cat_${cat}`));
    const keyboard = Markup.inlineKeyboard(categoryButtons, { columns: 2 });

    ctx.reply("📝 **REQUEST BATCH ACCESS**\n\nSelect a Category to view available batches:", { parse_mode: 'Markdown', reply_markup: keyboard.reply_markup });
});

bot.action(/^demand_cat_(.+)$/, async (ctx) => {
    const category = ctx.match[1];
    const userId = ctx.from.id.toString();

    const batches = await Batch.find({ category });
    if (batches.length === 0) {
        return ctx.editMessageText(`⚠️ No batches currently available under **${category}**.`, {
            parse_mode: 'Markdown',
            reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Back to Categories", "back_demand_cats")]]).reply_markup
        });
    }

    const state = await State.findOne({ userId });
    const selected = (state && state.selectedBatches) ? state.selectedBatches.map(b => b.toString()) : [];

    const buttons = batches.map(b => {
        const isSel = selected.includes(b._id.toString());
        return [Markup.button.callback(`${isSel ? '✅' : '☐'} ${b.name} (${b.totalFiles} items)`, `toggle_demand_${b._id}`)];
    });

    buttons.push([
        Markup.button.callback("📥 SUBMIT REQUEST", "submit_demand_req"),
        Markup.button.callback("⬅️ Categories", "back_demand_cats")
    ]);

    ctx.editMessageText(`📂 **Batches in ${category}**\nSelect batch(es) to request access:`, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard(buttons).reply_markup
    });
});

bot.action("back_demand_cats", async (ctx) => {
    const categoryButtons = CATEGORIES.map(cat => Markup.button.callback(cat, `demand_cat_${cat}`));
    ctx.editMessageText("📝 **REQUEST BATCH ACCESS**\n\nSelect a Category to view available batches:", {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard(categoryButtons, { columns: 2 }).reply_markup
    });
});

bot.action(/^toggle_demand_(.+)$/, async (ctx) => {
    const batchId = ctx.match[1];
    const userId = ctx.from.id.toString();

    let state = await State.findOne({ userId });
    if (!state) return ctx.answerCbQuery();

    let selected = state.selectedBatches ? state.selectedBatches.map(b => b.toString()) : [];
    if (selected.includes(batchId)) {
        selected = selected.filter(id => id !== batchId);
    } else {
        selected.push(batchId);
    }

    state.selectedBatches = selected;
    await state.save();
    ctx.answerCbQuery();

    const batch = await Batch.findById(batchId);
    if (!batch) return;

    const batches = await Batch.find({ category: batch.category });
    const buttons = batches.map(b => {
        const isSel = selected.includes(b._id.toString());
        return [Markup.button.callback(`${isSel ? '✅' : '☐'} ${b.name} (${b.totalFiles} items)`, `toggle_demand_${b._id}`)];
    });

    buttons.push([
        Markup.button.callback(`📥 SUBMIT REQUEST (${selected.length})`, "submit_demand_req"),
        Markup.button.callback("⬅️ Categories", "back_demand_cats")
    ]);

    ctx.editMessageText(`📂 **Batches in ${batch.category}**\nSelected: **${selected.length}** batch(es)`, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard(buttons).reply_markup
    });
});

bot.action("submit_demand_req", async (ctx) => {
    const userId = ctx.from.id.toString();
    const state = await State.findOne({ userId });

    if (!state || !state.selectedBatches || state.selectedBatches.length === 0) {
        return ctx.answerCbQuery("Please select at least 1 batch first!");
    }

    const requestedBatches = state.selectedBatches;

    const newReq = new AccessRequest({
        userId,
        userName: `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || 'User',
        userUsername: ctx.from.username || '',
        requestType: 'BATCH_ACCESS',
        requestedBatches,
        status: 'PENDING'
    });
    await newReq.save();

    await State.findOneAndDelete({ userId });
    ctx.answerCbQuery("Request submitted!");
    ctx.editMessageText("✅ **REQUEST SUBMITTED!**\n\nYour access request has been sent to the Admin. You will receive an automated notification once approved!", { parse_mode: 'Markdown' });

    // Notify Main Admin
    const batches = await Batch.find({ _id: { $in: requestedBatches } });
    const batchListStr = batches.map(b => `• ${b.name} (${b.category})`).join('\n');

    try {
        await bot.telegram.sendMessage(
            ADMIN_ID,
            `📩 **NEW BATCH ACCESS REQUEST**\n\n` +
            `👤 User: **${newReq.userName}** (@${newReq.userUsername})\n` +
            `🆔 User ID: \`${userId}\`\n\n` +
            `**Requested Batches:**\n${batchListStr}`,
            {
                parse_mode: 'Markdown',
                reply_markup: Markup.inlineKeyboard([
                    [
                        Markup.button.callback("✅ Approve Access", `approve_req_${newReq._id}`),
                        Markup.button.callback("❌ Deny", `deny_req_${newReq._id}`)
                    ]
                ]).reply_markup
            }
        );
    } catch (e) { console.error("Could not notify admin:", e); }
});


// -----------------------------------------------------
// MY BATCHES & CONTENT DELIVERY (/mybatches)
// -----------------------------------------------------

bot.command('mybatches', async (ctx) => {
    const userId = ctx.from.id.toString();
    const user = await User.findOne({ telegramId: userId }).populate('allowedBatches');

    let allowedBatches = [];
    if (userId === ADMIN_ID) {
        allowedBatches = await Batch.find({});
    } else if (user && user.allowedBatches) {
        allowedBatches = user.allowedBatches;
    }

    if (allowedBatches.length === 0) {
        return ctx.reply("🔒 **No Batches Authorized Yet**\n\nYou currently don't have access to any batches.\nUse **/demand** to request access from the Admin!", { parse_mode: 'Markdown' });
    }

    const buttons = allowedBatches.map(b => [Markup.button.callback(`📚 ${b.name} (${b.totalFiles} files)`, `getbatch_${b._id}`)]);
    ctx.reply("📚 **YOUR AUTHORIZED BATCHES:**\n\nClick a batch to receive all videos & files:", {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard(buttons).reply_markup
    });
});

bot.action(/^getbatch_(.+)$/, async (ctx) => {
    const batchId = ctx.match[1];
    const userId = ctx.from.id.toString();

    const batch = await Batch.findById(batchId);
    if (!batch) return ctx.answerCbQuery("Batch not found!");

    // Verify User Access
    if (userId !== ADMIN_ID) {
        const user = await User.findOne({ telegramId: userId });
        if (!user || !user.allowedBatches.includes(batchId)) {
            return ctx.answerCbQuery("You are not authorized for this batch!");
        }
    }

    ctx.answerCbQuery("Fetching files...");

    const items = await MediaItem.find({ batchId }).sort({ sequenceOrder: 1 });
    if (items.length === 0) {
        return ctx.reply(`⚠️ Batch **${batch.name}** has no videos or files yet.`, { parse_mode: 'Markdown' });
    }

    await ctx.reply(`🚀 **SENDING BATCH:** ${batch.name}\n📦 Total Items: **${items.length}**\n\n*Sending all files in strict sequential order...*`, { parse_mode: 'Markdown' });

    // Paced Sequential Delivery to prevent Telegram Rate Limits
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
            const caption = item.caption || `📚 ${batch.name} - File #${item.sequenceOrder}`;
            if (item.fileType === 'video') {
                await ctx.replyWithVideo(item.fileId, { caption });
            } else if (item.fileType === 'document') {
                await ctx.replyWithDocument(item.fileId, { caption });
            } else if (item.fileType === 'photo') {
                await ctx.replyWithPhoto(item.fileId, { caption });
            } else if (item.fileType === 'audio') {
                await ctx.replyWithAudio(item.fileId, { caption });
            }
            // Small 400ms delay between items
            await new Promise(r => setTimeout(r, 400));
        } catch (e) {
            console.error(`Error sending item ${i + 1}:`, e);
        }
    }

    ctx.reply(`✅ **Completed sending all ${items.length} items of ${batch.name}!**`);
});


// -----------------------------------------------------
// TEXT & MEDIA HANDLERS
// -----------------------------------------------------

bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id.toString();
    const state = await State.findOne({ userId });
    if (!state) return next();

    const text = ctx.message.text.trim();

    if (state.step === 'WAITING_BATCH_NAME') {
        const newBatch = new Batch({
            name: text,
            category: state.category,
            createdBy: userId
        });
        await newBatch.save();

        if (userId !== ADMIN_ID) {
            await User.findOneAndUpdate({ telegramId: userId }, { $inc: { batchesCreatedCount: 1 } });
        }

        const user = await User.findOne({ telegramId: userId });
        const createdCount = user ? user.batchesCreatedCount : 1;
        const maxAllowedStr = (user && user.maxBatchesAllowed >= 999999) ? 'Unlimited' : (user ? user.maxBatchesAllowed : 'Unlimited');

        state.step = 'UPLOADING_MEDIA';
        state.batchId = newBatch._id;
        state.mediaCount = 0;
        await state.save();

        ctx.reply(
            `🚀 **BATCH CREATED: ${newBatch.name}**\n` +
            `📌 Category: **${newBatch.category}**\n` +
            `📊 Your Batch Count: **${createdCount}** / **${maxAllowedStr}**\n\n` +
            `👉 **Send/Upload all your videos, files, documents, photos, or audio now!**\n` +
            `I will automatically index and preserve the exact order of all items.\n\n` +
            `Type **/done** or **/stopupload** when you are finished uploading.`,
            { parse_mode: 'Markdown' }
        );
    } else {
        return next();
    }
});

bot.on(['video', 'document', 'photo', 'audio'], async (ctx, next) => {
    const userId = ctx.from.id.toString();
    const state = await State.findOne({ userId });
    if (!state || state.step !== 'UPLOADING_MEDIA') return next();

    let fileId = '';
    let fileType = 'document';

    if (ctx.message.video) {
        fileId = ctx.message.video.file_id;
        fileType = 'video';
    } else if (ctx.message.document) {
        fileId = ctx.message.document.file_id;
        fileType = 'document';
    } else if (ctx.message.photo) {
        fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        fileType = 'photo';
    } else if (ctx.message.audio) {
        fileId = ctx.message.audio.file_id;
        fileType = 'audio';
    }

    try {
        const currentCount = await MediaItem.countDocuments({ batchId: state.batchId });
        const sequenceOrder = currentCount + 1;

        const mediaItem = new MediaItem({
            batchId: state.batchId,
            fileId,
            fileType,
            caption: ctx.message.caption || '',
            sequenceOrder
        });
        await mediaItem.save();

        await Batch.findByIdAndUpdate(state.batchId, { totalFiles: sequenceOrder });

        ctx.reply(`✅ Saved Item **#${sequenceOrder}** (${fileType})`, { parse_mode: 'Markdown' });
    } catch (e) {
        console.error("Error saving media item:", e);
        ctx.reply("❌ Error saving file.");
    }
});

require('./adminCommands')(bot);

module.exports = bot;
