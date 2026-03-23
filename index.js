const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');

// ==================== SOZLAMALAR ====================
const TOKEN = process.env.BOT_TOKEN || '8207719958:AAHypY0eleZakBm1SWY8QqpnzcZzfLdhukI';
const bot = new Telegraf(TOKEN);

// /app read-only, shuning uchun barcha fayllar /data ga saqlanadi
const DATA_DIR = process.env.DATA_DIR || '/data';

// /data papkasi mavjud bo'lmasa yaratish
if (!fs.existsSync(DATA_DIR)) {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}

const DB_FILE      = path.join(DATA_DIR, 'database.json');
const USERS_FILE   = path.join(DATA_DIR, 'users.json');
const STATS_FILE   = path.join(DATA_DIR, 'stats.json');
const ADMINS_FILE  = path.join(DATA_DIR, 'admins.json');
const BROADCAST_LOG = path.join(DATA_DIR, 'broadcast.json');

// Takroriy update'larni oldini olish
const processedUpdates = new Set();

// ==================== MA'LUMOTLAR ====================
const loadData = (file) => {
    try {
        if (!fs.existsSync(file)) return {};
        const data = fs.readFileSync(file, 'utf8');
        return data ? JSON.parse(data) : {};
    } catch (e) {
        console.error(`❌ Yuklash xatosi (${file}):`, e.message);
        return {};
    }
};

const saveData = (file, data) => {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error(`❌ Saqlash xatosi (${file}):`, e.message);
    }
};

// ==================== ADMIN TIZIMI ====================
const SUPER_ADMIN_IDS = [7590883918]; // Asosiy super admin

const getAdmins = () => {
    const data = loadData(ADMINS_FILE);
    return data.admins || [];
};

const isAdmin = (userId) => {
    const uid = Number(userId);
    if (SUPER_ADMIN_IDS.includes(uid)) return true;
    const admins = getAdmins();
    return admins.includes(uid);
};

const isSuperAdmin = (userId) => SUPER_ADMIN_IDS.includes(Number(userId));

const addAdmin = (userId) => {
    const data = loadData(ADMINS_FILE);
    if (!data.admins) data.admins = [];
    const uid = Number(userId);
    if (!data.admins.includes(uid) && !SUPER_ADMIN_IDS.includes(uid)) {
        data.admins.push(uid);
        saveData(ADMINS_FILE, data);
        return true;
    }
    return false;
};

const removeAdmin = (userId) => {
    const data = loadData(ADMINS_FILE);
    if (!data.admins) return false;
    const uid = Number(userId);
    const idx = data.admins.indexOf(uid);
    if (idx > -1) {
        data.admins.splice(idx, 1);
        saveData(ADMINS_FILE, data);
        return true;
    }
    return false;
};

// ==================== SESSION ====================
const userSessions = {};

const setSession = (userId, data) => {
    userSessions[userId] = { ...data, timestamp: Date.now() };
};

const getSession = (userId) => {
    const s = userSessions[userId];
    // 10 daqiqa o'tgan sessionlarni tozalash
    if (s && Date.now() - s.timestamp > 10 * 60 * 1000) {
        delete userSessions[userId];
        return null;
    }
    return s || null;
};

const clearSession = (userId) => delete userSessions[userId];

// ==================== YORDAMCHI ====================
const saveUser = (ctx) => {
    if (!ctx.from) return {};
    const users = loadData(USERS_FILE);
    const userId = ctx.from.id.toString();

    if (!users[userId]) {
        users[userId] = {
            id: userId,
            username: ctx.from.username || 'noname',
            first_name: ctx.from.first_name || 'Foydalanuvchi',
            last_name: ctx.from.last_name || '',
            joined_date: new Date().toISOString(),
            total_files: 0,
            storage_used: 0,
            last_active: new Date().toISOString(),
            is_banned: false,
            language: 'uz'
        };
    } else {
        users[userId].last_active = new Date().toISOString();
        users[userId].username = ctx.from.username || users[userId].username;
        users[userId].first_name = ctx.from.first_name || users[userId].first_name;
    }

    saveData(USERS_FILE, users);
    return users[userId];
};

const isBanned = (userId) => {
    const users = loadData(USERS_FILE);
    return users[userId.toString()]?.is_banned === true;
};

const updateStats = (action, fileSize = 0) => {
    const stats = loadData(STATS_FILE);
    if (!stats.total_uploads) stats.total_uploads = 0;
    if (!stats.total_downloads) stats.total_downloads = 0;
    if (!stats.total_searches) stats.total_searches = 0;
    if (!stats.total_storage) stats.total_storage = 0;
    if (!stats.daily) stats.daily = {};

    const today = new Date().toISOString().split('T')[0];
    if (!stats.daily[today]) stats.daily[today] = { uploads: 0, downloads: 0, searches: 0 };

    if (action === 'upload') {
        stats.total_uploads++;
        stats.total_storage += fileSize;
        stats.daily[today].uploads++;
    } else if (action === 'download') {
        stats.total_downloads++;
        stats.daily[today].downloads++;
    } else if (action === 'search') {
        stats.total_searches++;
        stats.daily[today].searches++;
    }

    saveData(STATS_FILE, stats);
};

const getFileCategory = (fileName) => {
    const ext = path.extname(fileName).toLowerCase();
    const categories = {
        '📄 PDF': ['.pdf'],
        '📝 Word': ['.doc', '.docx'],
        '📊 Excel': ['.xls', '.xlsx', '.csv'],
        '🖼 Rasm': ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'],
        '🎬 Video': ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'],
        '🎵 Audio': ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'],
        '🗜 Arxiv': ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'],
        '💻 Kod': ['.js', '.py', '.html', '.css', '.php', '.java', '.cpp', '.ts', '.go', '.rs', '.rb'],
        '📃 Matn': ['.txt', '.md', '.json', '.xml', '.yaml', '.yml'],
        '🎨 Dizayn': ['.psd', '.ai', '.fig', '.xd', '.sketch']
    };

    for (const [category, extensions] of Object.entries(categories)) {
        if (extensions.includes(ext)) return category;
    }
    return '📁 Boshqa';
};

const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' });
};

const getUserDisplayName = (user) => {
    return user.first_name + (user.last_name ? ' ' + user.last_name : '');
};

// ==================== KLAVIATURALAR ====================
const getMainKeyboard = (userId) => {
    const buttons = [
        ['📂 Mening fayllarim', '🔍 Qidiruv'],
        ['📊 Statistika', '🏷 Teglar'],
        ['❤️ Sevimlilar', '📁 Kategoriyalar'],
        ['📤 Fayl yuklash', '⚙️ Sozlamalar']
    ];
    if (isAdmin(userId)) {
        buttons.push(['👑 Admin Panel']);
    }
    return Markup.keyboard(buttons).resize();
};

const getAdminKeyboard = () => {
    return Markup.inlineKeyboard([
        [Markup.button.callback('👥 Foydalanuvchilar', 'adm_users'), Markup.button.callback('📊 Statistika', 'adm_stats')],
        [Markup.button.callback('📂 Barcha fayllar', 'adm_all_files'), Markup.button.callback('👑 Adminlar', 'adm_list')],
        [Markup.button.callback('➕ Admin qo\'shish', 'adm_add'), Markup.button.callback('➖ Admin olish', 'adm_remove')],
        [Markup.button.callback('📢 Broadcast', 'adm_broadcast'), Markup.button.callback('🚫 Ban/Unban', 'adm_ban')],
        [Markup.button.callback('🔍 Foydalanuvchi izlash', 'adm_search_user')]
    ]);
};

// ==================== MIDDLEWARE ====================
bot.telegram.deleteWebhook({ drop_pending_updates: true })
    .then(() => console.log('✅ Webhook tozalandi'))
    .catch(err => console.error('Webhook xato:', err));

// Takroriy update filtri
bot.use((ctx, next) => {
    const updateId = ctx.update?.update_id;
    if (updateId) {
        if (processedUpdates.has(updateId)) return;
        processedUpdates.add(updateId);
        if (processedUpdates.size > 2000) {
            const arr = Array.from(processedUpdates);
            arr.slice(0, 1000).forEach(id => processedUpdates.delete(id));
        }
    }
    return next();
});

// Ban tekshirish
bot.use((ctx, next) => {
    if (ctx.from && isBanned(ctx.from.id)) {
        return ctx.reply('🚫 Siz botdan bloklangansiz. Admin bilan bog\'laning.');
    }
    return next();
});

// ==================== START ====================
bot.start(async (ctx) => {
    const user = saveUser(ctx);
    const startParam = ctx.startPayload;

    // Referral tizimi
    if (startParam && startParam.startsWith('ref_')) {
        const refId = startParam.replace('ref_', '');
        const users = loadData(USERS_FILE);
        if (users[refId] && refId !== ctx.from.id.toString()) {
            if (!users[refId].referrals) users[refId].referrals = [];
            if (!users[refId].referrals.includes(ctx.from.id.toString())) {
                users[refId].referrals.push(ctx.from.id.toString());
                saveData(USERS_FILE, users);
            }
        }
    }

    await ctx.replyWithHTML(
        `🎉 <b>Assalomu alaykum, ${ctx.from.first_name}!</b>\n\n` +
        `🗂 <b>DevVault</b>ga xush kelibsiz!\n\n` +
        `📤 Fayllarni xavfsiz saqlash\n` +
        `🔍 Tez va oson qidirish\n` +
        `🏷 Teglar va kategoriyalar bilan tartiblashtirish\n` +
        `⭐ Sevimli fayllar ro'yxati\n\n` +
        `💡 Boshlash uchun fayl yuboring yoki menyudan tanlang!`,
        getMainKeyboard(ctx.from.id)
    );
});

// ==================== FAYL QABUL QILISH ====================
bot.on(['document', 'photo', 'video', 'audio', 'voice'], async (ctx) => {
    try {
        const userId = ctx.from.id.toString();
        saveUser(ctx);

        const db = loadData(DB_FILE);
        if (!db[userId]) db[userId] = {};

        let fileObj, fileName, fileSize, fileType;

        if (ctx.message.document) {
            fileObj = ctx.message.document;
            fileName = fileObj.file_name || `document_${Date.now()}`;
            fileSize = fileObj.file_size || 0;
            fileType = 'document';
        } else if (ctx.message.photo) {
            fileObj = ctx.message.photo[ctx.message.photo.length - 1];
            fileName = `photo_${Date.now()}.jpg`;
            fileSize = fileObj.file_size || 0;
            fileType = 'photo';
        } else if (ctx.message.video) {
            fileObj = ctx.message.video;
            fileName = fileObj.file_name || `video_${Date.now()}.mp4`;
            fileSize = fileObj.file_size || 0;
            fileType = 'video';
        } else if (ctx.message.audio) {
            fileObj = ctx.message.audio;
            fileName = fileObj.file_name || fileObj.title || `audio_${Date.now()}.mp3`;
            fileSize = fileObj.file_size || 0;
            fileType = 'audio';
        } else if (ctx.message.voice) {
            fileObj = ctx.message.voice;
            fileName = `voice_${Date.now()}.ogg`;
            fileSize = fileObj.file_size || 0;
            fileType = 'voice';
        }

        const fileKey = `f_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const caption = ctx.message.caption || '';

        db[userId][fileKey] = {
            file_id: fileObj.file_id,
            name: fileName,
            category: getFileCategory(fileName),
            size: fileSize,
            size_formatted: formatFileSize(fileSize),
            date: new Date().toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' }),
            date_iso: new Date().toISOString(),
            tags: [],
            description: caption,
            is_favorite: false,
            is_public: false,
            file_type: fileType,
            uploader_id: userId,
            download_count: 0
        };

        saveData(DB_FILE, db);

        const users = loadData(USERS_FILE);
        if (users[userId]) {
            users[userId].total_files = (users[userId].total_files || 0) + 1;
            users[userId].storage_used = (users[userId].storage_used || 0) + fileSize;
            saveData(USERS_FILE, users);
        }

        updateStats('upload', fileSize);

        await ctx.replyWithHTML(
            `✅ <b>Fayl saqlandi!</b>\n\n` +
            `📄 <b>Nom:</b> ${fileName}\n` +
            `📦 <b>Hajm:</b> ${formatFileSize(fileSize)}\n` +
            `📁 <b>Kategoriya:</b> ${getFileCategory(fileName)}\n` +
            `🔑 <b>ID:</b> <code>${fileKey}</code>`,
            Markup.inlineKeyboard([
                [
                    Markup.button.callback('🏷 Teg qo\'shish', `tag_${fileKey}`),
                    Markup.button.callback('📝 Tavsif', `desc_${fileKey}`)
                ],
                [
                    Markup.button.callback('⭐ Sevimli', `fav_${fileKey}`),
                    Markup.button.callback('🌐 Ommaviy', `pub_${fileKey}`)
                ],
                [
                    Markup.button.callback('🗑 O\'chirish', `del_${fileKey}`)
                ]
            ])
        );
    } catch (error) {
        console.error('Fayl qabul qilishda xato:', error);
        ctx.reply('❌ Faylni saqlashda xatolik. Qaytadan urinib ko\'ring.');
    }
});

// ==================== MATNLI BUYRUQLAR ====================
bot.on('text', async (ctx) => {
    try {
        const text = ctx.message.text;
        const userId = ctx.from.id.toString();
        const user = saveUser(ctx);
        const db = loadData(DB_FILE);
        const userFiles = db[userId] || {};

        // Session qayta ishlash
        const session = getSession(userId);
        if (session) {
            return await handleSession(ctx, session, text, userId, db, userFiles);
        }

        // Menyular
        switch (text) {
            case '📂 Mening fayllarim':
                return await showMyFiles(ctx, userId, userFiles);

            case '🔍 Qidiruv':
                setSession(userId, { action: 'waiting_search' });
                return ctx.replyWithHTML(
                    "🔍 <b>Qidiruv</b>\n\n" +
                    "Fayl nomi, kategoriya yoki teg bo'yicha qidiring.\n\n" +
                    "Misol: <code>rasm</code>, <code>pdf</code>, <code>ish</code>\n\n" +
                    "❌ Bekor qilish uchun /cancel yozing.",
                    Markup.keyboard([['❌ Bekor qilish']]).resize()
                );

            case '📊 Statistika':
                return await showStats(ctx, userId, user);

            case '🏷 Teglar':
                return await showTags(ctx, userId, userFiles);

            case '❤️ Sevimlilar':
                return await showFavorites(ctx, userId, userFiles);

            case '📁 Kategoriyalar':
                return await showCategories(ctx, userId, userFiles);

            case '📤 Fayl yuklash':
                return ctx.replyWithHTML(
                    "📤 <b>Fayl yuklash</b>\n\n" +
                    "Faylni shu yerga yuboring.\n\n" +
                    "✅ <b>Qo'llab-quvvatlanadi:</b>\n" +
                    "• Hujjatlar (PDF, Word, Excel)\n" +
                    "• Rasmlar (JPG, PNG, GIF, WebP)\n" +
                    "• Video va audio\n" +
                    "• Arxivlar (ZIP, RAR, 7z)\n" +
                    "• Kod fayllari\n" +
                    "• Ovozli xabarlar\n\n" +
                    "💡 <i>Fayl yuborishda caption yozsangiz, avtomatik tavsif bo'ladi.</i>"
                );

            case '⚙️ Sozlamalar':
                return await showSettings(ctx, userId, user);

            case '👑 Admin Panel':
                if (!isAdmin(userId)) return ctx.reply('❌ Ruxsat yo\'q.');
                return await showAdminPanel(ctx);

            case '❌ Bekor qilish':
            case '/cancel':
                clearSession(userId);
                return ctx.reply('❌ Bekor qilindi.', getMainKeyboard(userId));

            default:
                // Agar qidiruv sessiyasida bo'lmasa, matnni qidiruv sifatida qabul qilish
                return await searchFiles(ctx, userId, userFiles, text);
        }
    } catch (error) {
        console.error('Matn xatosi:', error);
        ctx.reply('❌ Xatolik yuz berdi.');
    }
});

// ==================== SESSION HANDLER ====================
async function handleSession(ctx, session, text, userId, db, userFiles) {
    if (text === '❌ Bekor qilish' || text === '/cancel') {
        clearSession(userId);
        return ctx.reply('❌ Bekor qilindi.', getMainKeyboard(userId));
    }

    const { action, fileKey } = session;

    if (action === 'waiting_tag' && userFiles[fileKey]) {
        const tags = text.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 0 && t.length <= 20);
        userFiles[fileKey].tags = tags;
        db[userId] = userFiles;
        saveData(DB_FILE, db);
        clearSession(userId);
        return ctx.reply(`✅ ${tags.length} ta teg saqlandi: ${tags.map(t => '#' + t).join(' ')}`, getMainKeyboard(userId));
    }

    if (action === 'waiting_desc' && userFiles[fileKey]) {
        userFiles[fileKey].description = text.slice(0, 200);
        db[userId] = userFiles;
        saveData(DB_FILE, db);
        clearSession(userId);
        return ctx.reply('✅ Tavsif saqlandi!', getMainKeyboard(userId));
    }

    if (action === 'waiting_search') {
        clearSession(userId);
        return await searchFiles(ctx, userId, userFiles, text);
    }

    if (action === 'adm_add_admin') {
        clearSession(userId);
        const targetId = text.trim();
        const users = loadData(USERS_FILE);
        const targetUser = users[targetId];

        if (!targetUser) {
            return ctx.reply('❌ Bu ID bilan foydalanuvchi topilmadi. Avval foydalanuvchi botga yozishi kerak.', getMainKeyboard(userId));
        }

        if (addAdmin(targetId)) {
            const displayName = getUserDisplayName(targetUser);
            await ctx.reply(`✅ <b>${displayName}</b> admin qilindi!`, { parse_mode: 'HTML', ...getMainKeyboard(userId) });
            // Foydalanuvchiga xabar yuborish
            try {
                await bot.telegram.sendMessage(targetId, '👑 Siz admin qildingiz! /start yozing.');
            } catch (e) {}
        } else {
            ctx.reply('⚠️ Bu foydalanuvchi allaqachon admin.', getMainKeyboard(userId));
        }
        return;
    }

    if (action === 'adm_remove_admin') {
        clearSession(userId);
        const targetId = text.trim();
        if (removeAdmin(targetId)) {
            return ctx.reply('✅ Admin huquqlari olindi.', getMainKeyboard(userId));
        }
        return ctx.reply('❌ Bu foydalanuvchi admin emas yoki topilmadi.', getMainKeyboard(userId));
    }

    if (action === 'adm_ban_user') {
        clearSession(userId);
        const targetId = text.trim();
        const users = loadData(USERS_FILE);
        if (!users[targetId]) return ctx.reply('❌ Foydalanuvchi topilmadi.');

        users[targetId].is_banned = !users[targetId].is_banned;
        const bannedStatus = users[targetId].is_banned;
        saveData(USERS_FILE, users);

        const displayName = getUserDisplayName(users[targetId]);
        return ctx.reply(
            bannedStatus ? `🚫 <b>${displayName}</b> bloklandi.` : `✅ <b>${displayName}</b> blokdan chiqarildi.`,
            { parse_mode: 'HTML', ...getMainKeyboard(userId) }
        );
    }

    if (action === 'adm_broadcast') {
        clearSession(userId);
        const users = loadData(USERS_FILE);
        const userIds = Object.keys(users);
        let sent = 0, failed = 0;

        const progressMsg = await ctx.reply(`📢 Broadcast boshlandi... 0/${userIds.length}`);

        for (const uid of userIds) {
            try {
                await bot.telegram.sendMessage(uid,
                    `📢 <b>Admin xabari:</b>\n\n${text}`,
                    { parse_mode: 'HTML' }
                );
                sent++;
            } catch (e) {
                failed++;
            }
            // Progress yangilash (har 10 ta)
            if ((sent + failed) % 10 === 0) {
                try {
                    await bot.telegram.editMessageText(ctx.chat.id, progressMsg.message_id, null,
                        `📢 Broadcast: ${sent + failed}/${userIds.length}`
                    );
                } catch (e) {}
            }
            await new Promise(r => setTimeout(r, 50)); // Rate limit
        }

        return ctx.reply(`✅ Broadcast tugadi!\n\n📨 Yuborildi: ${sent}\n❌ Xato: ${failed}`, getMainKeyboard(userId));
    }

    if (action === 'adm_search_user') {
        clearSession(userId);
        const users = loadData(USERS_FILE);
        const query = text.toLowerCase().trim();

        const found = Object.values(users).filter(u =>
            u.username?.toLowerCase().includes(query) ||
            u.first_name?.toLowerCase().includes(query) ||
            u.id === query
        );

        if (found.length === 0) return ctx.reply('❌ Foydalanuvchi topilmadi.');

        for (const u of found.slice(0, 5)) {
            const adminBadge = isAdmin(u.id) ? '👑 ' : '';
            const bannedBadge = u.is_banned ? '🚫 ' : '';
            await ctx.replyWithHTML(
                `${adminBadge}${bannedBadge}<b>${getUserDisplayName(u)}</b>\n` +
                `🆔 ID: <code>${u.id}</code>\n` +
                `👤 Username: @${u.username || 'yo\'q'}\n` +
                `📁 Fayllar: ${u.total_files || 0}\n` +
                `💾 Hajm: ${formatFileSize(u.storage_used || 0)}\n` +
                `📅 Ro'yxat: ${formatDate(u.joined_date)}\n` +
                `🕐 Faol: ${formatDate(u.last_active)}`,
                Markup.inlineKeyboard([
                    [Markup.button.callback(u.is_banned ? '✅ Unban' : '🚫 Ban', `adm_toggle_ban_${u.id}`)],
                    [Markup.button.callback(isAdmin(u.id) ? '➖ Admin olish' : '➕ Admin qilish', `adm_toggle_admin_${u.id}`)],
                    [Markup.button.callback('📂 Fayllarini ko\'rish', `adm_view_files_${u.id}`)]
                ])
            );
        }
        return;
    }

    clearSession(userId);
    return ctx.reply('⚠️ Noma\'lum buyruq. Qaytadan urinib ko\'ring.', getMainKeyboard(userId));
}

// ==================== ASOSIY FUNKSIYALAR ====================
async function showMyFiles(ctx, userId, userFiles) {
    const keys = Object.keys(userFiles);
    if (keys.length === 0) {
        return ctx.reply(
            "📂 Sizda hali fayllar yo'q.\n\n📤 Fayl yuborish orqali boshlang!",
            getMainKeyboard(userId)
        );
    }

    const recentFiles = keys
        .sort((a, b) => (userFiles[b].date_iso || '') > (userFiles[a].date_iso || '') ? 1 : -1)
        .slice(0, 10);

    let msg = `📂 <b>Sizning fayllaringiz</b> (${keys.length} ta, so'nggi 10):\n\n`;

    recentFiles.forEach((k, i) => {
        const f = userFiles[k];
        const star = f.is_favorite ? '⭐' : '';
        const pub = f.is_public ? '🌐' : '';
        msg += `${i + 1}. ${star}${pub} <b>${f.name}</b>\n`;
        msg += `   ${f.category} • ${f.size_formatted} • ${f.date}\n`;
        if (f.tags && f.tags.length > 0) msg += `   🏷 ${f.tags.map(t => '#' + t).join(' ')}\n`;
        msg += '\n';
    });

    await ctx.replyWithHTML(msg, Markup.inlineKeyboard([
        [Markup.button.callback('📁 Kategoriyalar', 'show_cats'), Markup.button.callback('⭐ Sevimlilar', 'show_favs')],
        [Markup.button.callback('🔢 Barchasini yuborish', 'send_all_files')]
    ]));
}

async function showStats(ctx, userId, user) {
    const stats = loadData(STATS_FILE);
    const allUsers = loadData(USERS_FILE);
    const db = loadData(DB_FILE);
    const userFiles = db[userId] || {};

    const categories = {};
    Object.values(userFiles).forEach(f => {
        categories[f.category] = (categories[f.category] || 0) + 1;
    });
    const topCat = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];

    await ctx.replyWithHTML(
        `📊 <b>Shaxsiy statistika</b>\n\n` +
        `👤 Ism: ${getUserDisplayName(user)}\n` +
        `📁 Jami fayllar: <b>${user.total_files || 0} ta</b>\n` +
        `💾 Hajm: <b>${formatFileSize(user.storage_used || 0)}</b>\n` +
        `⭐ Sevimlilar: ${Object.values(userFiles).filter(f => f.is_favorite).length} ta\n` +
        `🌐 Ommaviy: ${Object.values(userFiles).filter(f => f.is_public).length} ta\n` +
        (topCat ? `🏆 Eng ko'p kategoriya: ${topCat[0]} (${topCat[1]} ta)\n` : '') +
        `📅 Ro'yxat: ${formatDate(user.joined_date)}\n\n` +
        `🌍 <b>Bot statistikasi</b>\n\n` +
        `👥 Foydalanuvchilar: <b>${Object.keys(allUsers).length} ta</b>\n` +
        `📤 Yuklangan: <b>${stats.total_uploads || 0} ta</b>\n` +
        `💾 Umumiy: <b>${formatFileSize(stats.total_storage || 0)}</b>\n` +
        `🔍 Qidiruvlar: <b>${stats.total_searches || 0} ta</b>`
    );
}

async function showTags(ctx, userId, userFiles) {
    const tagCount = {};
    Object.values(userFiles).forEach(f => {
        if (f.tags) f.tags.forEach(t => {
            tagCount[t] = (tagCount[t] || 0) + 1;
        });
    });

    if (Object.keys(tagCount).length === 0) {
        return ctx.reply(
            "🏷 Teglar yo'q.\n\nFayl yuklanganda '🏷 Teg qo'shish' tugmasini bosing.",
            getMainKeyboard(userId)
        );
    }

    const sorted = Object.entries(tagCount).sort((a, b) => b[1] - a[1]);
    const btns = sorted.map(([t, n]) => [
        Markup.button.callback(`#${t} (${n})`, `searchtag_${t}`)
    ]);

    ctx.reply("🏷 <b>Teglaringiz:</b>\n\nTegni tanlang:", {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(btns)
    });
}

async function showFavorites(ctx, userId, userFiles) {
    const favorites = Object.entries(userFiles).filter(([_, f]) => f.is_favorite);

    if (favorites.length === 0) {
        return ctx.reply("⭐ Sevimli fayllar yo'q.\n\nFaylga ⭐ tugmasini bosib qo'shing.", getMainKeyboard(userId));
    }

    await ctx.replyWithHTML(`⭐ <b>Sevimli fayllar (${favorites.length} ta):</b>`);

    for (const [key, f] of favorites.slice(0, 10)) {
        try {
            await ctx.sendDocument(f.file_id, {
                caption: `⭐ <b>${f.name}</b>\n${f.category} • ${f.size_formatted}\n📅 ${f.date}`,
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('⭐ Sevimlilardan olish', `fav_${key}`), Markup.button.callback('🗑 O\'chirish', `del_${key}`)]
                ])
            });
            updateStats('download');
        } catch (e) {}
    }
}

async function showCategories(ctx, userId, userFiles) {
    const cats = {};
    Object.values(userFiles).forEach(f => {
        cats[f.category] = (cats[f.category] || 0) + 1;
    });

    if (Object.keys(cats).length === 0) {
        return ctx.reply("📁 Kategoriyalar bo'sh.", getMainKeyboard(userId));
    }

    const btns = Object.entries(cats)
        .sort((a, b) => b[1] - a[1])
        .map(([c, n]) => [Markup.button.callback(`${c} (${n} ta)`, `viewcat_${c}`)]);

    ctx.reply("📁 <b>Kategoriyalar:</b>", { parse_mode: 'HTML', ...Markup.inlineKeyboard(btns) });
}

async function showSettings(ctx, userId, user) {
    const db = loadData(DB_FILE);
    const userFiles = db[userId] || {};
    const fileCount = Object.keys(userFiles).length;

    ctx.replyWithHTML(
        `⚙️ <b>Sozlamalar</b>\n\n` +
        `👤 <b>${getUserDisplayName(user)}</b>\n` +
        `🆔 ID: <code>${userId}</code>\n` +
        `📁 Fayllar: ${fileCount} ta\n` +
        `💾 Hajm: ${formatFileSize(user.storage_used || 0)}`,
        Markup.inlineKeyboard([
            [Markup.button.callback('📊 Ma\'lumotlarni eksport', 'export_data')],
            [Markup.button.callback('🔗 Referal havolam', 'my_referral')],
            [Markup.button.callback('⚠️ Barcha fayllarni o\'chirish', 'clear_all_confirm')]
        ])
    );
}

async function showAdminPanel(ctx) {
    const stats = loadData(STATS_FILE);
    const allUsers = loadData(USERS_FILE);
    const admins = getAdmins();

    await ctx.replyWithHTML(
        `👑 <b>ADMIN PANEL</b>\n\n` +
        `👥 Foydalanuvchilar: <b>${Object.keys(allUsers).length}</b>\n` +
        `📂 Yuklangan: <b>${stats.total_uploads || 0}</b>\n` +
        `💾 Hajm: <b>${formatFileSize(stats.total_storage || 0)}</b>\n` +
        `🔍 Qidiruvlar: <b>${stats.total_searches || 0}</b>\n` +
        `👑 Adminlar: <b>${admins.length + SUPER_ADMIN_IDS.length}</b>`,
        getAdminKeyboard()
    );
}

async function searchFiles(ctx, userId, userFiles, searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    if (term.length < 2) {
        return ctx.reply("❌ Kamida 2 ta harf kiriting.", getMainKeyboard(userId));
    }

    const results = Object.entries(userFiles).filter(([_, f]) =>
        f.name.toLowerCase().includes(term) ||
        f.category.toLowerCase().includes(term) ||
        (f.tags && f.tags.some(tag => tag.toLowerCase().includes(term))) ||
        (f.description && f.description.toLowerCase().includes(term))
    );

    if (results.length > 0) {
        updateStats('search');
        await ctx.replyWithHTML(
            `🔎 <b>${results.length} ta natija topildi</b>\n` +
            `So'rov: <code>${searchTerm}</code>\n\n` +
            (results.length > 5 ? `<i>Faqat birinchi 5 ta ko'rsatildi</i>` : '')
        );

        for (const [key, f] of results.slice(0, 5)) {
            const tags = f.tags?.length > 0 ? `\n🏷 ${f.tags.map(t => '#' + t).join(' ')}` : '';
            const desc = f.description ? `\n📝 ${f.description}` : '';
            try {
                await ctx.sendDocument(f.file_id, {
                    caption:
                        `<b>${f.name}</b>\n\n` +
                        `${f.category} • ${f.size_formatted}\n` +
                        `📅 ${f.date}${tags}${desc}`,
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback('⭐ Sevimli', `fav_${key}`),
                            Markup.button.callback('🗑 O\'chirish', `del_${key}`)
                        ]
                    ])
                });
                updateStats('download');
            } catch (e) {}
        }
    } else {
        ctx.replyWithHTML(
            `❌ <b>Hech narsa topilmadi</b>\n` +
            `So'rov: <code>${searchTerm}</code>\n\n` +
            `💡 Fayl nomi, kategoriya yoki teg bo'yicha qidiring.`,
            getMainKeyboard(userId)
        );
    }
}

// ==================== CALLBACK HANDLERS ====================

// Eksport
bot.action('export_data', async (ctx) => {
    try {
        const userId = ctx.from.id.toString();
        const db = loadData(DB_FILE);
        const userData = db[userId] || {};

        if (Object.keys(userData).length === 0) {
            return ctx.answerCbQuery("❌ Eksport qilish uchun ma'lumot yo'q.");
        }

        const exportData = {
            user_info: loadData(USERS_FILE)[userId],
            files: userData,
            export_date: new Date().toISOString(),
            total_files: Object.keys(userData).length
        };

        const buffer = Buffer.from(JSON.stringify(exportData, null, 2));
        await ctx.replyWithDocument(
            { source: buffer, filename: `devvault_${userId}_${Date.now()}.json` },
            { caption: `📊 Ma'lumotlaringiz eksporti\n📁 ${Object.keys(userData).length} ta fayl` }
        );
        ctx.answerCbQuery("✅ Eksport tayyor");
    } catch (e) {
        ctx.answerCbQuery("❌ Eksport xatosi");
    }
});

// Referal
bot.action('my_referral', async (ctx) => {
    const userId = ctx.from.id.toString();
    const users = loadData(USERS_FILE);
    const user = users[userId];
    const refCount = user?.referrals?.length || 0;
    const link = `https://t.me/${ctx.botInfo?.username}?start=ref_${userId}`;

    ctx.answerCbQuery();
    ctx.replyWithHTML(
        `🔗 <b>Referal havolangiz:</b>\n\n` +
        `<code>${link}</code>\n\n` +
        `👥 Taklif qilganlar: ${refCount} ta`
    );
});

// Teg qo'shish
bot.action(/tag_(.+)/, (ctx) => {
    const fileKey = ctx.match[1];
    setSession(ctx.from.id, { action: 'waiting_tag', fileKey });
    ctx.replyWithHTML(
        "🏷 <b>Teg qo'shish</b>\n\nVergul bilan ajrating:\n<code>ish, muhim, 2024</code>",
        Markup.keyboard([['❌ Bekor qilish']]).resize()
    );
    ctx.answerCbQuery();
});

// Tavsif
bot.action(/desc_(.+)/, (ctx) => {
    const fileKey = ctx.match[1];
    setSession(ctx.from.id, { action: 'waiting_desc', fileKey });
    ctx.replyWithHTML(
        "📝 <b>Tavsif qo'shish</b>\n\nFayl uchun qisqa tavsif yozing (max 200 belgi):",
        Markup.keyboard([['❌ Bekor qilish']]).resize()
    );
    ctx.answerCbQuery();
});

// Sevimli toggle
bot.action(/fav_(.+)/, (ctx) => {
    try {
        const db = loadData(DB_FILE);
        const userId = ctx.from.id.toString();
        const fileKey = ctx.match[1];

        if (db[userId]?.[fileKey]) {
            db[userId][fileKey].is_favorite = !db[userId][fileKey].is_favorite;
            saveData(DB_FILE, db);
            const isFav = db[userId][fileKey].is_favorite;
            ctx.answerCbQuery(isFav ? "⭐ Sevimlilarga qo'shildi!" : "💔 Sevimlilardan olib tashlandi");
        } else {
            ctx.answerCbQuery("❌ Fayl topilmadi");
        }
    } catch (e) {
        ctx.answerCbQuery("❌ Xatolik");
    }
});

// Ommaviy toggle
bot.action(/pub_(.+)/, (ctx) => {
    try {
        const db = loadData(DB_FILE);
        const userId = ctx.from.id.toString();
        const fileKey = ctx.match[1];

        if (db[userId]?.[fileKey]) {
            db[userId][fileKey].is_public = !db[userId][fileKey].is_public;
            saveData(DB_FILE, db);
            const isPub = db[userId][fileKey].is_public;
            ctx.answerCbQuery(isPub ? "🌐 Fayl ommaviy qilindi" : "🔒 Fayl shaxsiy qilindi");
        } else {
            ctx.answerCbQuery("❌ Fayl topilmadi");
        }
    } catch (e) {
        ctx.answerCbQuery("❌ Xatolik");
    }
});

// O'chirish
bot.action(/del_(.+)/, async (ctx) => {
    try {
        const db = loadData(DB_FILE);
        const userId = ctx.from.id.toString();
        const fileKey = ctx.match[1];

        if (db[userId]?.[fileKey]) {
            const f = db[userId][fileKey];
            const size = f.size || 0;
            delete db[userId][fileKey];
            saveData(DB_FILE, db);

            const users = loadData(USERS_FILE);
            if (users[userId]) {
                users[userId].total_files = Math.max(0, (users[userId].total_files || 1) - 1);
                users[userId].storage_used = Math.max(0, (users[userId].storage_used || 0) - size);
                saveData(USERS_FILE, users);
            }

            await ctx.deleteMessage().catch(() => {});
            ctx.answerCbQuery(`🗑 "${f.name}" o'chirildi`);
        } else {
            ctx.answerCbQuery("❌ Fayl topilmadi");
        }
    } catch (e) {
        ctx.answerCbQuery("❌ O'chirishda xatolik");
    }
});

// Barcha fayllarni yuborish
bot.action('send_all_files', async (ctx) => {
    try {
        ctx.answerCbQuery("📤 Fayllar yuborilmoqda...");
        const db = loadData(DB_FILE);
        const userId = ctx.from.id.toString();
        const userFiles = db[userId] || {};
        const keys = Object.keys(userFiles);

        if (keys.length === 0) return;

        await ctx.reply(`📤 ${keys.length} ta fayl yuborilmoqda...`);

        for (const key of keys.slice(0, 20)) {
            const f = userFiles[key];
            try {
                await ctx.sendDocument(f.file_id, {
                    caption: `<b>${f.name}</b>\n${f.category} • ${f.size_formatted}`,
                    parse_mode: 'HTML'
                });
                updateStats('download');
                await new Promise(r => setTimeout(r, 300));
            } catch (e) {}
        }

        if (keys.length > 20) {
            await ctx.reply(`⚠️ Faqat birinchi 20 ta fayl yuborildi. Qolgan ${keys.length - 20} ta mavjud.`);
        }
    } catch (e) {
        ctx.answerCbQuery("❌ Xatolik");
    }
});

// Kategoriyalar (inline)
bot.action('show_cats', async (ctx) => {
    try {
        ctx.answerCbQuery();
        const db = loadData(DB_FILE);
        const userFiles = db[ctx.from.id] || {};
        const cats = {};
        Object.values(userFiles).forEach(f => {
            cats[f.category] = (cats[f.category] || 0) + 1;
        });

        if (Object.keys(cats).length === 0) return ctx.answerCbQuery("❌ Bo'sh");

        const btns = Object.entries(cats)
            .sort((a, b) => b[1] - a[1])
            .map(([c, n]) => [Markup.button.callback(`${c} (${n})`, `viewcat_${c}`)]);

        await ctx.reply("📁 <b>Kategoriyalar:</b>", { parse_mode: 'HTML', ...Markup.inlineKeyboard(btns) });
    } catch (e) {}
});

// Sevimlilar (inline)
bot.action('show_favs', async (ctx) => {
    ctx.answerCbQuery();
    const db = loadData(DB_FILE);
    const userId = ctx.from.id.toString();
    await showFavorites(ctx, userId, db[userId] || {});
});

// Kategoriya bo'yicha ko'rish
bot.action(/viewcat_(.+)/, async (ctx) => {
    try {
        ctx.answerCbQuery();
        const category = ctx.match[1];
        const db = loadData(DB_FILE);
        const userFiles = db[ctx.from.id] || {};
        const catFiles = Object.entries(userFiles).filter(([_, f]) => f.category === category);

        if (catFiles.length === 0) return ctx.reply("❌ Bu kategoriyada fayl yo'q.");

        await ctx.replyWithHTML(`${category} <b>(${catFiles.length} ta):</b>`);

        for (const [key, f] of catFiles.slice(0, 10)) {
            try {
                await ctx.sendDocument(f.file_id, {
                    caption: `<b>${f.name}</b>\n${f.size_formatted} • ${f.date}`,
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('⭐ Sevimli', `fav_${key}`), Markup.button.callback('🗑 O\'chirish', `del_${key}`)]
                    ])
                });
                updateStats('download');
            } catch (e) {}
        }
    } catch (e) {}
});

// Teg bo'yicha qidirish
bot.action(/searchtag_(.+)/, async (ctx) => {
    try {
        ctx.answerCbQuery();
        const tag = ctx.match[1];
        const db = loadData(DB_FILE);
        const userFiles = db[ctx.from.id] || {};
        const tagged = Object.entries(userFiles).filter(([_, f]) => f.tags?.includes(tag));

        if (tagged.length === 0) return ctx.reply(`❌ #${tag} tegi bo'yicha fayl topilmadi.`);

        await ctx.replyWithHTML(`🏷 <b>#${tag}</b> (${tagged.length} ta):`);

        for (const [key, f] of tagged.slice(0, 10)) {
            try {
                await ctx.sendDocument(f.file_id, {
                    caption: `<b>${f.name}</b>\n${f.category} • ${f.size_formatted}`,
                    parse_mode: 'HTML'
                });
            } catch (e) {}
        }
    } catch (e) {}
});

// O'chirish tasdiqlash
bot.action('clear_all_confirm', (ctx) => {
    ctx.answerCbQuery();
    ctx.replyWithHTML(
        "⚠️ <b>DIQQAT!</b>\n\nBarcha fayllaringiz o'chib ketadi!\n❗️Bu amalni ortga qaytarib bo'lmaydi.",
        Markup.inlineKeyboard([
            [Markup.button.callback('✅ Ha, barchasini o\'chir', 'clear_all_execute')],
            [Markup.button.callback('❌ Bekor qilish', 'cancel_clear')]
        ])
    );
});

bot.action('clear_all_execute', (ctx) => {
    const userId = ctx.from.id.toString();
    const db = loadData(DB_FILE);
    const count = db[userId] ? Object.keys(db[userId]).length : 0;
    if (db[userId]) { delete db[userId]; saveData(DB_FILE, db); }

    const users = loadData(USERS_FILE);
    if (users[userId]) {
        users[userId].total_files = 0;
        users[userId].storage_used = 0;
        saveData(USERS_FILE, users);
    }

    ctx.editMessageText(`🗑 ${count} ta fayl o'chirildi.`);
    ctx.answerCbQuery("✅ Tozalandi");
});

bot.action('cancel_clear', (ctx) => {
    ctx.editMessageText("❌ Bekor qilindi. Fayllar saqlanib qoldi.");
    ctx.answerCbQuery();
});

// ==================== ADMIN ACTIONS ====================

// Adminlar ro'yxati
bot.action('adm_list', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("❌ Ruxsat yo'q");
    ctx.answerCbQuery();

    const admins = getAdmins();
    const users = loadData(USERS_FILE);

    let msg = "👑 <b>Adminlar ro'yxati:</b>\n\n";

    SUPER_ADMIN_IDS.forEach(id => {
        const u = users[id.toString()];
        msg += `🌟 <b>${u ? getUserDisplayName(u) : 'Super Admin'}</b> (${id}) — Super Admin\n`;
    });

    admins.forEach(id => {
        const u = users[id.toString()];
        msg += `👑 <b>${u ? getUserDisplayName(u) : 'Admin'}</b> (${id})\n`;
    });

    ctx.replyWithHTML(msg);
});

// Admin qo'shish
bot.action('adm_add', (ctx) => {
    if (!isSuperAdmin(ctx.from.id)) return ctx.answerCbQuery("❌ Faqat Super Admin");
    ctx.answerCbQuery();
    setSession(ctx.from.id, { action: 'adm_add_admin' });
    ctx.reply(
        "➕ <b>Admin qo'shish</b>\n\nFoydalanuvchi ID sini yozing:\n(Foydalanuvchi avval botga /start bosgan bo'lishi kerak)",
        { parse_mode: 'HTML', ...Markup.keyboard([['❌ Bekor qilish']]).resize() }
    );
});

// Admin olish
bot.action('adm_remove', (ctx) => {
    if (!isSuperAdmin(ctx.from.id)) return ctx.answerCbQuery("❌ Faqat Super Admin");
    ctx.answerCbQuery();
    setSession(ctx.from.id, { action: 'adm_remove_admin' });
    ctx.reply(
        "➖ <b>Admin huquqini olish</b>\n\nFoydalanuvchi ID sini yozing:",
        { parse_mode: 'HTML', ...Markup.keyboard([['❌ Bekor qilish']]).resize() }
    );
});

// Inline admin toggle
bot.action(/adm_toggle_admin_(.+)/, async (ctx) => {
    if (!isSuperAdmin(ctx.from.id)) return ctx.answerCbQuery("❌ Faqat Super Admin");

    const targetId = ctx.match[1];
    const users = loadData(USERS_FILE);
    const targetUser = users[targetId];

    if (isAdmin(targetId) && !isSuperAdmin(targetId)) {
        removeAdmin(targetId);
        ctx.answerCbQuery("➖ Admin huquqi olindi");
        try { await bot.telegram.sendMessage(targetId, '⚠️ Admin huquqingiz olindi.'); } catch (e) {}
    } else {
        addAdmin(targetId);
        ctx.answerCbQuery("➕ Admin qilindi");
        try { await bot.telegram.sendMessage(targetId, '👑 Siz admin bo\'ldingiz! /start yozing.'); } catch (e) {}
    }

    // Tugmani yangilash
    try {
        await ctx.editMessageReplyMarkup(Markup.inlineKeyboard([
            [Markup.button.callback(isAdmin(targetId) ? '➖ Admin olish' : '➕ Admin qilish', `adm_toggle_admin_${targetId}`)],
            [Markup.button.callback('📂 Fayllarini ko\'rish', `adm_view_files_${targetId}`)]
        ]).reply_markup);
    } catch (e) {}
});

// Inline ban toggle
bot.action(/adm_toggle_ban_(.+)/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("❌ Ruxsat yo'q");

    const targetId = ctx.match[1];
    const users = loadData(USERS_FILE);

    if (!users[targetId]) return ctx.answerCbQuery("❌ Foydalanuvchi topilmadi");

    users[targetId].is_banned = !users[targetId].is_banned;
    const banned = users[targetId].is_banned;
    saveData(USERS_FILE, users);

    ctx.answerCbQuery(banned ? "🚫 Bloklandi" : "✅ Blokdan chiqarildi");

    try {
        if (banned) {
            await bot.telegram.sendMessage(targetId, '🚫 Siz admin tomonidan bloklangansiz.');
        } else {
            await bot.telegram.sendMessage(targetId, '✅ Blokingiz olib tashlandi.');
        }
    } catch (e) {}
});

// Foydalanuvchi fayllarini ko'rish (admin)
bot.action(/adm_view_files_(.+)/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("❌ Ruxsat yo'q");
    ctx.answerCbQuery();

    const targetId = ctx.match[1];
    const db = loadData(DB_FILE);
    const users = loadData(USERS_FILE);
    const targetFiles = db[targetId] || {};
    const targetUser = users[targetId];
    const keys = Object.keys(targetFiles);

    if (keys.length === 0) {
        return ctx.reply(`❌ ${targetUser ? getUserDisplayName(targetUser) : targetId} ning fayllari yo'q.`);
    }

    await ctx.replyWithHTML(
        `📂 <b>${targetUser ? getUserDisplayName(targetUser) : targetId}</b> ning fayllari (${keys.length} ta):`
    );

    for (const key of keys.slice(0, 10)) {
        const f = targetFiles[key];
        try {
            await ctx.sendDocument(f.file_id, {
                caption:
                    `<b>${f.name}</b>\n` +
                    `${f.category} • ${f.size_formatted}\n` +
                    `📅 ${f.date}\n` +
                    `👤 ${targetUser ? getUserDisplayName(targetUser) : targetId}`,
                parse_mode: 'HTML'
            });
            await new Promise(r => setTimeout(r, 200));
        } catch (e) {}
    }

    if (keys.length > 10) {
        await ctx.reply(`... va yana ${keys.length - 10} ta fayl mavjud.`);
    }
});

// Admin: barcha fayllar
bot.action('adm_all_files', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("❌ Ruxsat yo'q");
    ctx.answerCbQuery();

    const db = loadData(DB_FILE);
    const users = loadData(USERS_FILE);

    let totalFiles = 0;
    let msg = "📂 <b>Barcha foydalanuvchilar fayllari:</b>\n\n";

    const usersSorted = Object.entries(db)
        .map(([uid, files]) => ({ uid, count: Object.keys(files).length }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15);

    for (const { uid, count } of usersSorted) {
        const u = users[uid];
        const name = u ? getUserDisplayName(u) : uid;
        const storage = u ? formatFileSize(u.storage_used || 0) : '?';
        msg += `👤 <b>${name}</b>: ${count} fayl (${storage})\n`;
        totalFiles += count;
    }

    msg += `\n📊 Ko'rsatildi: ${usersSorted.length} foydalanuvchi, ${totalFiles} fayl`;

    const btns = usersSorted.slice(0, 5).map(({ uid }) => {
        const u = users[uid];
        return [Markup.button.callback(`📂 ${u ? getUserDisplayName(u) : uid}`, `adm_view_files_${uid}`)];
    });

    ctx.replyWithHTML(msg, Markup.inlineKeyboard(btns));
});

// Admin: foydalanuvchilar
bot.action('adm_users', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("❌ Ruxsat yo'q");
    ctx.answerCbQuery();

    const usersData = loadData(USERS_FILE);
    const sorted = Object.values(usersData)
        .sort((a, b) => b.total_files - a.total_files)
        .slice(0, 10);

    let msg = "👥 <b>Top 10 Foydalanuvchi:</b>\n\n";
    sorted.forEach((u, i) => {
        const adminBadge = isAdmin(u.id) ? '👑' : '';
        const bannedBadge = u.is_banned ? '🚫' : '';
        msg += `${i + 1}. ${adminBadge}${bannedBadge} <b>${getUserDisplayName(u)}</b>\n`;
        msg += `   📁 ${u.total_files} fayl • 💾 ${formatFileSize(u.storage_used || 0)}\n`;
        msg += `   🆔 <code>${u.id}</code>\n\n`;
    });

    ctx.replyWithHTML(msg);
});

// Admin: statistika
bot.action('adm_stats', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("❌ Ruxsat yo'q");
    ctx.answerCbQuery();

    const stats = loadData(STATS_FILE);
    const users = loadData(USERS_FILE);
    const db = loadData(DB_FILE);

    const bannedCount = Object.values(users).filter(u => u.is_banned).length;
    const today = new Date().toISOString().split('T')[0];
    const todayStats = stats.daily?.[today] || { uploads: 0, downloads: 0, searches: 0 };

    // Top kategoriyalar
    const allCats = {};
    Object.values(db).forEach(userFiles => {
        Object.values(userFiles).forEach(f => {
            allCats[f.category] = (allCats[f.category] || 0) + 1;
        });
    });
    const topCats = Object.entries(allCats).sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([c, n]) => `${c}: ${n}`).join('\n');

    ctx.replyWithHTML(
        `📊 <b>BATAFSIL STATISTIKA</b>\n\n` +
        `👥 Foydalanuvchilar: ${Object.keys(users).length}\n` +
        `🚫 Bloklangan: ${bannedCount}\n` +
        `👑 Adminlar: ${getAdmins().length + SUPER_ADMIN_IDS.length}\n\n` +
        `📁 Jami fayllar: ${stats.total_uploads || 0}\n` +
        `💾 Umumiy hajm: ${formatFileSize(stats.total_storage || 0)}\n` +
        `🔍 Qidiruvlar: ${stats.total_searches || 0}\n\n` +
        `📅 <b>Bugun (${today}):</b>\n` +
        `📤 Yuklagan: ${todayStats.uploads}\n` +
        `📥 Yuklab olgan: ${todayStats.downloads}\n` +
        `🔍 Qidirgan: ${todayStats.searches}\n\n` +
        `📊 <b>Top kategoriyalar:</b>\n${topCats}`
    );
});

// Admin: broadcast
bot.action('adm_broadcast', (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("❌ Ruxsat yo'q");
    ctx.answerCbQuery();
    setSession(ctx.from.id, { action: 'adm_broadcast' });
    ctx.reply(
        "📢 <b>Broadcast xabari</b>\n\nBarcha foydalanuvchilarga yubormoqchi bo'lgan xabarni yozing:",
        { parse_mode: 'HTML', ...Markup.keyboard([['❌ Bekor qilish']]).resize() }
    );
});

// Admin: ban
bot.action('adm_ban', (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("❌ Ruxsat yo'q");
    ctx.answerCbQuery();
    setSession(ctx.from.id, { action: 'adm_ban_user' });
    ctx.reply(
        "🚫 <b>Ban/Unban</b>\n\nFoydalanuvchi ID sini yozing (ban bo'lsa unban, unban bo'lsa ban qilinadi):",
        { parse_mode: 'HTML', ...Markup.keyboard([['❌ Bekor qilish']]).resize() }
    );
});

// Admin: foydalanuvchi qidirish
bot.action('adm_search_user', (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("❌ Ruxsat yo'q");
    ctx.answerCbQuery();
    setSession(ctx.from.id, { action: 'adm_search_user' });
    ctx.reply(
        "🔍 <b>Foydalanuvchi qidirish</b>\n\nIsm, username yoki ID kiriting:",
        { parse_mode: 'HTML', ...Markup.keyboard([['❌ Bekor qilish']]).resize() }
    );
});

// ==================== XATO TUTISH ====================
bot.catch((err, ctx) => {
    console.error(`❌ [${ctx?.updateType}]:`, err.message);
    if (ctx?.reply) {
        ctx.reply('❌ Xatolik yuz berdi. Qaytadan urinib ko\'ring.').catch(() => {});
    }
});

// ==================== ISHGA TUSHIRISH ====================
bot.launch({
    dropPendingUpdates: true,
    allowedUpdates: ['message', 'callback_query']
}).then(() => {
    console.log('✅ DevVault Bot ishga tushdi!');
    console.log(`📅 ${new Date().toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' })}`);
    console.log(`👑 Super Admin IDs: ${SUPER_ADMIN_IDS.join(', ')}`);
}).catch(err => {
    console.error('❌ Bot ishga tushmadi:', err);
    process.exit(1);
});

process.once('SIGINT', () => { console.log('\n⏹ To\'xtatilmoqda...'); bot.stop('SIGINT'); });
process.once('SIGTERM', () => { console.log('\n⏹ To\'xtatilmoqda...'); bot.stop('SIGTERM'); });
