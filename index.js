const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');

const TOKEN = '8207719958:AAHypY0eleZakBm1SWY8QqpnzcZzfLdhukI';
const bot = new Telegraf(TOKEN);

// Database fayllari
const DB_FILE = 'database.json';
const USERS_FILE = 'users.json';
const STATS_FILE = 'stats.json';

// Ma'lumotlarni yuklash va saqlash funksiyalari
const loadData = (file) => {
    try {
        if (!fs.existsSync(file)) return {};
        const data = fs.readFileSync(file, 'utf8');
        return data ? JSON.parse(data) : {};
    } catch (e) {
        return {};
    }
};
const saveData = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

const userSessions = {};
const ADMIN_IDS = [7590883918];
const isAdmin = (userId) => ADMIN_IDS.includes(Number(userId));

// --- YORDAMCHI FUNKSIYALAR ---

const saveUser = (ctx) => {
    if (!ctx.from) return {};
    const users = loadData(USERS_FILE);
    const userId = ctx.from.id.toString();
    if (!users[userId]) {
        users[userId] = {
            id: userId,
            username: ctx.from.username || 'noname',
            first_name: ctx.from.first_name || 'User',
            joined_date: new Date().toISOString(),
            total_files: 0,
            storage_used: 0,
            last_active: new Date().toISOString()
        };
    } else {
        users[userId].last_active = new Date().toISOString();
    }
    saveData(USERS_FILE, users);
    return users[userId];
};

const updateStats = (action, fileSize = 0) => {
    const stats = loadData(STATS_FILE);
    if (!stats.total_uploads) stats.total_uploads = 0;
    if (!stats.total_downloads) stats.total_downloads = 0;
    if (!stats.total_searches) stats.total_searches = 0;
    if (!stats.total_storage) stats.total_storage = 0;

    if (action === 'upload') { stats.total_uploads++; stats.total_storage += fileSize; }
    else if (action === 'download') { stats.total_downloads++; }
    else if (action === 'search') { stats.total_searches++; }
    saveData(STATS_FILE, stats);
};

const getFileCategory = (fileName) => {
    const ext = path.extname(fileName).toLowerCase();
    const categories = {
        'PDF': ['.pdf'], 'Word': ['.doc', '.docx'], 'Excel': ['.xls', '.xlsx', '.csv'],
        'Rasm': ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
        'Video': ['.mp4', '.avi', '.mkv', '.mov'], 'Audio': ['.mp3', '.wav', '.flac'],
        'Archive': ['.zip', '.rar', '.7z'], 'Code': ['.js', '.py', '.html', '.css', '.php'],
        'Text': ['.txt', '.md']
    };
    for (const [category, extensions] of Object.entries(categories)) {
        if (extensions.includes(ext)) return category;
    }
    return 'Boshqa';
};

const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const getMainKeyboard = (userId) => {
    const buttons = [
        ['📂 Mening fayllarim', '🔍 Qidiruv'],
        ['📊 Statistika', '🏷 Teglar'],
        ['📤 Fayl yuklash', '⚙️ Sozlamalar']
    ];
    if (isAdmin(userId)) buttons.push(['👑 Admin Panel']);
    return Markup.keyboard(buttons).resize();
};

// --- START ---
bot.start((ctx) => {
    saveUser(ctx);
    ctx.replyWithHTML(`🎉 <b>Salom, ${ctx.from.first_name}!</b>\n\nDevVault-ga xush kelibsiz. Fayl yuboring yoki menyudan foydalaning.`, getMainKeyboard(ctx.from.id));
});

// --- FAYL QABUL QILISH ---
bot.on(['document', 'photo'], async (ctx) => {
    const userId = ctx.from.id.toString();
    saveUser(ctx);
    const db = loadData(DB_FILE);
    if (!db[userId]) db[userId] = {};

    let doc = ctx.message.document || ctx.message.photo[ctx.message.photo.length - 1];
    let fileName = ctx.message.document ? doc.file_name : `photo_${Date.now()}.jpg`;
    let fileSize = doc.file_size || 0;
    let fileKey = `f_${Date.now()}`;

    db[userId][fileKey] = {
        file_id: doc.file_id,
        name: fileName,
        category: getFileCategory(fileName),
        size: fileSize,
        size_formatted: formatFileSize(fileSize),
        date: new Date().toLocaleString('uz-UZ'),
        tags: [],
        description: '',
        is_favorite: false
    };

    saveData(DB_FILE, db);
    const users = loadData(USERS_FILE);
    users[userId].total_files = (users[userId].total_files || 0) + 1;
    users[userId].storage_used = (users[userId].storage_used || 0) + fileSize;
    saveData(USERS_FILE, users);
    updateStats('upload', fileSize);

    ctx.reply(`✅ Saqlandi: ${fileName}`, Markup.inlineKeyboard([
        [Markup.button.callback('🏷 Teg', `tag_${fileKey}`), Markup.button.callback('📝 Tavsif', `desc_${fileKey}`)],
        [Markup.button.callback('⭐ Sevimli', `fav_${fileKey}`), Markup.button.callback('🗑 O\'chirish', `del_${fileKey}`)]
    ]));
});

// --- MATNLI BUYRUQLAR ---
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const userId = ctx.from.id.toString();
    const user = saveUser(ctx);
    const db = loadData(DB_FILE);
    const userFiles = db[userId] || {};

    // Session logic
    if (userSessions[userId]) {
        const { action, fileKey } = userSessions[userId];
        if (action === 'waiting_tag' && userFiles[fileKey]) {
            userFiles[fileKey].tags = text.split(',').map(t => t.trim());
            saveData(DB_FILE, db);
            ctx.reply("✅ Teglar saqlandi.");
        } else if (action === 'waiting_desc' && userFiles[fileKey]) {
            userFiles[fileKey].description = text;
            saveData(DB_FILE, db);
            ctx.reply("✅ Tavsif saqlandi.");
        }
        delete userSessions[userId];
        return;
    }

    if (text === '📂 Mening fayllarim') {
        const keys = Object.keys(userFiles);
        if (keys.length === 0) return ctx.reply("Sizda hali fayllar yo'q.");
        let msg = `📂 <b>Fayllaringiz (${keys.length} ta):</b>\n\n`;
        keys.slice(-10).forEach((k, i) => msg += `${i + 1}. ${userFiles[k].name}\n`);
        ctx.replyWithHTML(msg, Markup.inlineKeyboard([
            [Markup.button.callback('📁 Kategoriyalar', 'show_cats')],
            [Markup.button.callback('⭐ Sevimlilar', 'show_favs')]
        ]));
    }
    else if (text === '📊 Statistika') {
        const stats = loadData(STATS_FILE);
        ctx.replyWithHTML(`📊 <b>Sizning statistikangiz:</b>\n\n📁 Fayllar: ${user.total_files || 0} ta\n💾 Hajm: ${formatFileSize(user.storage_used || 0)}\n\n🌍 <b>Bot umumiy statistikasi:</b>\n📤 Jami yuklangan: ${stats.total_uploads || 0}\n💾 Jami xotira: ${formatFileSize(stats.total_storage || 0)}`);
    }
    else if (text === '🏷 Teglar') {
        let allTags = new Set();
        Object.values(userFiles).forEach(f => {
            if (f.tags && Array.isArray(f.tags)) f.tags.forEach(t => allTags.add(t));
        });
        if (allTags.size === 0) return ctx.reply("Siz hali hech qaysi faylga teg qo'shmagansiz.");
        let btns = Array.from(allTags).map(t => [Markup.button.callback(`#${t}`, `searchtag_${t}`)]);
        ctx.reply("🏷 Sizning teglaringiz:", Markup.inlineKeyboard(btns));
    }
    else if (text === '🔍 Qidiruv') {
        ctx.reply("🔍 Fayl nomini yoki qismini yozing:");
    }
    else if (text === '⚙️ Sozlamalar') {
        ctx.reply("⚙️ Sozlamalar bo'limi:", Markup.inlineKeyboard([
            [Markup.button.callback('⚠️ Hammasini o\'chirish', 'clear_all_confirm')],
            [Markup.button.callback('📊 Ma\'lumotlarni eksport qilish', 'export_data')]
        ]));
    }
    else if (text === '👑 Admin Panel' && isAdmin(userId)) {
        const stats = loadData(STATS_FILE);
        const allUsers = loadData(USERS_FILE);
        ctx.replyWithHTML(`👑 <b>ADMIN PANEL</b>\n\n👥 Foydalanuvchilar: ${Object.keys(allUsers).length}\n📂 Jami fayllar: ${stats.total_uploads || 0}`, Markup.inlineKeyboard([
            [Markup.button.callback('👥 Foydalanuvchilar ro\'yxati', 'adm_users')]
        ]));
    }
    else {
        // Qidiruv mantiqi
        const results = Object.entries(userFiles).filter(([_, f]) => f.name.toLowerCase().includes(text.toLowerCase()));
        if (results.length > 0) {
            updateStats('search');
            ctx.reply(`🔎 ${results.length} ta natija topildi:`);
            results.slice(0, 5).forEach(async ([key, f]) => {
                await ctx.sendDocument(f.file_id, { caption: `📄 ${f.name}\n📅 ${f.date}\n📦 ${f.size_formatted}` });
            });
        } else {
            ctx.reply("❌ Hech narsa topilmadi.");
        }
    }
});

// --- CALLBACK HANDLERS (TUGMALAR UCHUN) ---

// 1. Ma'lumotlarni JSON formatida eksport qilish
bot.action('export_data', (ctx) => {
    const userId = ctx.from.id.toString();
    const db = loadData(DB_FILE);
    const userData = db[userId] || {};

    if (Object.keys(userData).length === 0) {
        return ctx.answerCbQuery("Sizda eksport qilish uchun ma'lumot yo'q.");
    }

    const buffer = Buffer.from(JSON.stringify(userData, null, 2));
    ctx.replyWithDocument({ source: buffer, filename: `backup_${userId}.json` }, { caption: "Sizning barcha fayllaringiz ma'lumotlari (JSON formatida)." });
    ctx.answerCbQuery();
});

// 2. Hammasini o'chirish (Tasdiqlash so'rash)
bot.action('clear_all_confirm', (ctx) => {
    ctx.editMessageText("⚠️ Diqqat! Barcha fayllaringizni o'chirib tashlamoqchimisiz? Bu amalni ortga qaytarib bo'lmaydi!", Markup.inlineKeyboard([
        [Markup.button.callback('✅ Ha, o\'chirilsin', 'clear_all_execute')],
        [Markup.button.callback('❌ Yo\'q, qolsin', 'cancel_clear')]
    ]));
});

// 3. Hammasini o'chirish (Amalni bajarish)
bot.action('clear_all_execute', (ctx) => {
    const userId = ctx.from.id.toString();

    // DB dan o'chirish
    const db = loadData(DB_FILE);
    if (db[userId]) {
        delete db[userId];
        saveData(DB_FILE, db);
    }

    // User statistikasini nolga tushirish
    const users = loadData(USERS_FILE);
    if (users[userId]) {
        users[userId].total_files = 0;
        users[userId].storage_used = 0;
        saveData(USERS_FILE, users);
    }

    ctx.editMessageText("🗑 Barcha ma'lumotlaringiz muvaffaqiyatli o'chirildi.");
    ctx.answerCbQuery();
});

// 4. Bekor qilish
bot.action('cancel_clear', (ctx) => {
    ctx.editMessageText("Amal bekor qilindi.");
    ctx.answerCbQuery();
});

// Qolgan handlerlar...
bot.action(/tag_(.+)/, (ctx) => {
    userSessions[ctx.from.id] = { action: 'waiting_tag', fileKey: ctx.match[1] };
    ctx.reply("🏷 Teglarni vergul bilan yuboring (masalan: ish, muhim, rasm):");
    ctx.answerCbQuery();
});

bot.action(/desc_(.+)/, (ctx) => {
    userSessions[ctx.from.id] = { action: 'waiting_desc', fileKey: ctx.match[1] };
    ctx.reply("📝 Fayl uchun tavsif yozing:");
    ctx.answerCbQuery();
});

bot.action(/fav_(.+)/, (ctx) => {
    const db = loadData(DB_FILE);
    const userId = ctx.from.id.toString();
    const fileKey = ctx.match[1];
    if (db[userId] && db[userId][fileKey]) {
        db[userId][fileKey].is_favorite = !db[userId][fileKey].is_favorite;
        saveData(DB_FILE, db);
        ctx.answerCbQuery(db[userId][fileKey].is_favorite ? "⭐ Sevimlilarga qo'shildi" : "Sevimlilardan olindi");
    }
});

bot.action(/del_(.+)/, (ctx) => {
    const db = loadData(DB_FILE);
    const userId = ctx.from.id.toString();
    const fileKey = ctx.match[1];
    if (db[userId] && db[userId][fileKey]) {
        const size = db[userId][fileKey].size || 0;
        delete db[userId][fileKey];
        saveData(DB_FILE, db);
        const users = loadData(USERS_FILE);
        if (users[userId]) {
            users[userId].total_files = Math.max(0, (users[userId].total_files || 1) - 1);
            users[userId].storage_used = Math.max(0, (users[userId].storage_used || size) - size);
            saveData(USERS_FILE, users);
        }
        ctx.deleteMessage().catch(() => { });
        ctx.answerCbQuery("O'chirildi");
    }
});

bot.action('show_cats', (ctx) => {
    const db = loadData(DB_FILE)[ctx.from.id] || {};
    let cats = {};
    Object.values(db).forEach(f => cats[f.category] = (cats[f.category] || 0) + 1);
    let btns = Object.entries(cats).map(([c, n]) => [Markup.button.callback(`${c} (${n})`, `viewcat_${c}`)]);
    if (btns.length === 0) return ctx.answerCbQuery("Kategoriyalar bo'sh");
    ctx.editMessageText("📁 Kategoriyalaringiz:", Markup.inlineKeyboard(btns));
});

bot.action('adm_users', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const usersData = loadData(USERS_FILE);
    const users = Object.values(usersData).sort((a, b) => b.total_files - a.total_files).slice(0, 10);
    let msg = "👥 <b>Top 10 Foydalanuvchi:</b>\n\n";
    users.forEach((u, i) => msg += `${i + 1}. ${u.first_name} (@${u.username}): ${u.total_files} fayl\n`);
    ctx.replyWithHTML(msg);
    ctx.answerCbQuery();
});

bot.catch((err) => console.error('Xatolik:', err));

bot.launch().then(() => console.log("🚀 Bot muvaffaqiyatli ishga tushdi!"));