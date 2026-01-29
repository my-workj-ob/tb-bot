const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.BOT_TOKEN || '8207719958:AAHypY0eleZakBm1SWY8QqpnzcZzfLdhukI';
const bot = new Telegraf(TOKEN);

// Database fayllari
const DB_FILE = 'database.json';
const USERS_FILE = 'users.json';
const STATS_FILE = 'stats.json';

// ✅ QAYTA ISHLANGAN UPDATE'LARNI KUZATISH (takrorlanishni oldini olish)
const processedUpdates = new Set();

// Ma'lumotlarni yuklash va saqlash funksiyalari
const loadData = (file) => {
    try {
        if (!fs.existsSync(file)) return {};
        const data = fs.readFileSync(file, 'utf8');
        return data ? JSON.parse(data) : {};
    } catch (e) {
        console.error(`Fayl yuklashda xato (${file}):`, e.message);
        return {};
    }
};

const saveData = (file, data) => {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error(`Fayl saqlashda xato (${file}):`, e.message);
    }
};

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
            first_name: ctx.from.first_name || 'Foydalanuvchi',
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

    if (action === 'upload') {
        stats.total_uploads++;
        stats.total_storage += fileSize;
    } else if (action === 'download') {
        stats.total_downloads++;
    } else if (action === 'search') {
        stats.total_searches++;
    }
    
    saveData(STATS_FILE, stats);
};

const getFileCategory = (fileName) => {
    const ext = path.extname(fileName).toLowerCase();
    const categories = {
        'PDF': ['.pdf'],
        'Word': ['.doc', '.docx'],
        'Excel': ['.xls', '.xlsx', '.csv'],
        'Rasm': ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'],
        'Video': ['.mp4', '.avi', '.mkv', '.mov', '.wmv'],
        'Audio': ['.mp3', '.wav', '.flac', '.aac', '.ogg'],
        'Archive': ['.zip', '.rar', '.7z', '.tar', '.gz'],
        'Kod': ['.js', '.py', '.html', '.css', '.php', '.java', '.cpp', '.ts'],
        'Matn': ['.txt', '.md', '.json']
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
    if (isAdmin(userId)) {
        buttons.push(['👑 Admin Panel']);
    }
    return Markup.keyboard(buttons).resize();
};

// ✅ BOT ISHGA TUSHGANDA ESKI UPDATE'LARNI TOZALASH
bot.telegram.deleteWebhook({ drop_pending_updates: true })
    .then(() => console.log('✅ Webhook va pending updates tozalandi'))
    .catch(err => console.error('Webhook tozalashda xato:', err));

// ✅ UPDATE'LARNI TEKSHIRISH MIDDLEWARE
bot.use((ctx, next) => {
    const updateId = ctx.update.update_id;
    
    // Agar bu update allaqachon qayta ishlangan bo'lsa, o'tkazib yuboramiz
    if (processedUpdates.has(updateId)) {
        console.log(`⚠️ Takroriy update o'tkazib yuborildi: ${updateId}`);
        return;
    }
    
    // Yangi update'ni qo'shamiz
    processedUpdates.add(updateId);
    
    // Xotira to'lib ketmasligi uchun eski ID'larni tozalaymiz (1000 dan ortiq bo'lsa)
    if (processedUpdates.size > 1000) {
        const arr = Array.from(processedUpdates);
        arr.slice(0, 500).forEach(id => processedUpdates.delete(id));
    }
    
    return next();
});

// --- START ---
bot.start((ctx) => {
    saveUser(ctx);
    ctx.replyWithHTML(
        `🎉 <b>Assalomu alaykum, ${ctx.from.first_name}!</b>\n\n` +
        `DevVault-ga xush kelibsiz! 🗂\n\n` +
        `📤 Fayl yuboring yoki menyudan kerakli bo'limni tanlang.\n` +
        `💡 Fayllaringizni xavfsiz saqlash va osongina topish uchun yaratilgan bot.`,
        getMainKeyboard(ctx.from.id)
    );
});

// --- FAYL QABUL QILISH ---
bot.on(['document', 'photo'], async (ctx) => {
    try {
        const userId = ctx.from.id.toString();
        saveUser(ctx);
        
        const db = loadData(DB_FILE);
        if (!db[userId]) db[userId] = {};

        let doc = ctx.message.document || ctx.message.photo[ctx.message.photo.length - 1];
        let fileName = ctx.message.document ? doc.file_name : `photo_${Date.now()}.jpg`;
        let fileSize = doc.file_size || 0;
        let fileKey = `f_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        db[userId][fileKey] = {
            file_id: doc.file_id,
            name: fileName,
            category: getFileCategory(fileName),
            size: fileSize,
            size_formatted: formatFileSize(fileSize),
            date: new Date().toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' }),
            tags: [],
            description: '',
            is_favorite: false
        };

        saveData(DB_FILE, db);
        
        // Foydalanuvchi statistikasini yangilash
        const users = loadData(USERS_FILE);
        if (users[userId]) {
            users[userId].total_files = (users[userId].total_files || 0) + 1;
            users[userId].storage_used = (users[userId].storage_used || 0) + fileSize;
            saveData(USERS_FILE, users);
        }
        
        updateStats('upload', fileSize);

        await ctx.reply(
            `✅ <b>Fayl muvaffaqiyatli saqlandi!</b>\n\n` +
            `📄 Nom: ${fileName}\n` +
            `📦 Hajm: ${formatFileSize(fileSize)}\n` +
            `📁 Kategoriya: ${getFileCategory(fileName)}`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback('🏷 Teg qo\'shish', `tag_${fileKey}`),
                        Markup.button.callback('📝 Tavsif', `desc_${fileKey}`)
                    ],
                    [
                        Markup.button.callback('⭐ Sevimli', `fav_${fileKey}`),
                        Markup.button.callback('🗑 O\'chirish', `del_${fileKey}`)
                    ]
                ])
            }
        );
    } catch (error) {
        console.error('Fayl qabul qilishda xato:', error);
        ctx.reply('❌ Faylni saqlashda xatolik yuz berdi. Iltimos, qaytadan urinib ko\'ring.');
    }
});

// --- MATNLI BUYRUQLAR ---
bot.on('text', async (ctx) => {
    try {
        const text = ctx.message.text;
        const userId = ctx.from.id.toString();
        const user = saveUser(ctx);
        const db = loadData(DB_FILE);
        const userFiles = db[userId] || {};

        // Session logic (Teg va tavsif qo'shish uchun)
        if (userSessions[userId]) {
            const { action, fileKey } = userSessions[userId];
            
            if (action === 'waiting_tag' && userFiles[fileKey]) {
                userFiles[fileKey].tags = text.split(',').map(t => t.trim()).filter(t => t.length > 0);
                saveData(DB_FILE, db);
                ctx.reply("✅ Teglar muvaffaqiyatli saqlandi!", getMainKeyboard(userId));
                delete userSessions[userId];
                return;
            } else if (action === 'waiting_desc' && userFiles[fileKey]) {
                userFiles[fileKey].description = text;
                saveData(DB_FILE, db);
                ctx.reply("✅ Tavsif muvaffaqiyatli saqlandi!", getMainKeyboard(userId));
                delete userSessions[userId];
                return;
            }
            
            delete userSessions[userId];
        }

        // Menyu buyruqlari
        if (text === '📂 Mening fayllarim') {
            const keys = Object.keys(userFiles);
            
            if (keys.length === 0) {
                return ctx.reply(
                    "📂 Sizda hali fayllar mavjud emas.\n\n" +
                    "📤 Fayl yuklash uchun yuqoridagi menyudan foydalaning yoki shunchaki fayl yuboring.",
                    getMainKeyboard(userId)
                );
            }
            
            let msg = `📂 <b>Sizning fayllaringiz (${keys.length} ta):</b>\n\n`;
            const recentFiles = keys.slice(-10).reverse();
            
            recentFiles.forEach((k, i) => {
                const f = userFiles[k];
                const star = f.is_favorite ? '⭐ ' : '';
                msg += `${i + 1}. ${star}<b>${f.name}</b>\n`;
                msg += `   📦 ${f.size_formatted} • 📁 ${f.category} • 📅 ${f.date}\n\n`;
            });
            
            ctx.replyWithHTML(msg, Markup.inlineKeyboard([
                [Markup.button.callback('📁 Kategoriyalar', 'show_cats')],
                [Markup.button.callback('⭐ Sevimlilar', 'show_favs')]
            ]));
        }
        else if (text === '📊 Statistika') {
            const stats = loadData(STATS_FILE);
            const allUsers = loadData(USERS_FILE);
            
            ctx.replyWithHTML(
                `📊 <b>Sizning statistikangiz:</b>\n\n` +
                `📁 Jami fayllar: ${user.total_files || 0} ta\n` +
                `💾 Foydalanilgan hajm: ${formatFileSize(user.storage_used || 0)}\n` +
                `📅 Ro'yxatdan o'tgan: ${new Date(user.joined_date).toLocaleDateString('uz-UZ')}\n\n` +
                `🌍 <b>Bot umumiy statistikasi:</b>\n\n` +
                `👥 Foydalanuvchilar: ${Object.keys(allUsers).length} ta\n` +
                `📤 Jami yuklangan fayllar: ${stats.total_uploads || 0} ta\n` +
                `💾 Umumiy hajm: ${formatFileSize(stats.total_storage || 0)}\n` +
                `🔍 Qidiruvlar soni: ${stats.total_searches || 0} ta`
            );
        }
        else if (text === '🏷 Teglar') {
            let allTags = new Set();
            
            Object.values(userFiles).forEach(f => {
                if (f.tags && Array.isArray(f.tags)) {
                    f.tags.forEach(t => allTags.add(t));
                }
            });
            
            if (allTags.size === 0) {
                return ctx.reply(
                    "🏷 Siz hali hech qaysi faylga teg qo'shmagansiz.\n\n" +
                    "Faylga teg qo'shish uchun fayl yuklangandan keyin '🏷 Teg qo'shish' tugmasini bosing.",
                    getMainKeyboard(userId)
                );
            }
            
            let btns = Array.from(allTags).map(t => [
                Markup.button.callback(`#${t}`, `searchtag_${t}`)
            ]);
            
            ctx.reply("🏷 <b>Sizning teglaringiz:</b>\n\nTegni tanlang:", {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard(btns)
            });
        }
        else if (text === '🔍 Qidiruv') {
            ctx.reply(
                "🔍 <b>Qidiruv</b>\n\n" +
                "Fayl nomini yoki uning bir qismini yozing.\n" +
                "Masalan: <code>rasm</code>, <code>dokument</code>, <code>pdf</code>",
                { parse_mode: 'HTML' }
            );
        }
        else if (text === '📤 Fayl yuklash') {
            ctx.reply(
                "📤 <b>Fayl yuklash</b>\n\n" +
                "Yuklash uchun faylni shu yerga yuboring.\n\n" +
                "✅ Qo'llab-quvvatlanadigan formatlar:\n" +
                "• Hujjatlar (PDF, Word, Excel)\n" +
                "• Rasmlar (JPG, PNG, GIF)\n" +
                "• Video va audio fayllar\n" +
                "• Arxivlar va kod fayllari",
                { parse_mode: 'HTML' }
            );
        }
        else if (text === '⚙️ Sozlamalar') {
            ctx.reply("⚙️ <b>Sozlamalar</b>", {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('📊 Ma\'lumotlarni eksport', 'export_data')],
                    [Markup.button.callback('⚠️ Barcha fayllarni o\'chirish', 'clear_all_confirm')]
                ])
            });
        }
        else if (text === '👑 Admin Panel' && isAdmin(userId)) {
            const stats = loadData(STATS_FILE);
            const allUsers = loadData(USERS_FILE);
            
            ctx.replyWithHTML(
                `👑 <b>ADMIN PANEL</b>\n\n` +
                `👥 Ro'yxatdan o'tgan foydalanuvchilar: ${Object.keys(allUsers).length}\n` +
                `📂 Jami yuklangan fayllar: ${stats.total_uploads || 0}\n` +
                `💾 Umumiy hajm: ${formatFileSize(stats.total_storage || 0)}\n` +
                `🔍 Qidiruvlar: ${stats.total_searches || 0}`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('👥 Top foydalanuvchilar', 'adm_users')],
                    [Markup.button.callback('📊 Batafsil statistika', 'adm_stats')]
                ])
            );
        }
        else {
            // Qidiruv mantiqi
            const searchTerm = text.toLowerCase().trim();
            const results = Object.entries(userFiles).filter(([_, f]) => 
                f.name.toLowerCase().includes(searchTerm) ||
                f.category.toLowerCase().includes(searchTerm) ||
                (f.tags && f.tags.some(tag => tag.toLowerCase().includes(searchTerm)))
            );
            
            if (results.length > 0) {
                updateStats('search');
                
                ctx.reply(
                    `🔎 <b>Qidiruv natijalari:</b> ${results.length} ta fayl topildi\n\n` +
                    `So'rov: <code>${text}</code>`,
                    { parse_mode: 'HTML' }
                );
                
                // Faqat birinchi 5 ta natijani ko'rsatamiz
                const topResults = results.slice(0, 5);
                
                for (const [key, f] of topResults) {
                    const star = f.is_favorite ? '⭐ ' : '';
                    const tags = f.tags && f.tags.length > 0 ? `\n🏷 ${f.tags.join(', ')}` : '';
                    const desc = f.description ? `\n📝 ${f.description}` : '';
                    
                    await ctx.sendDocument(f.file_id, {
                        caption: 
                            `${star}<b>${f.name}</b>\n\n` +
                            `📁 Kategoriya: ${f.category}\n` +
                            `📦 Hajm: ${f.size_formatted}\n` +
                            `📅 Yuklangan: ${f.date}${tags}${desc}`,
                        parse_mode: 'HTML',
                        ...Markup.inlineKeyboard([
                            [
                                Markup.button.callback('⭐ Sevimli', `fav_${key}`),
                                Markup.button.callback('🗑 O\'chirish', `del_${key}`)
                            ]
                        ])
                    });
                    
                    updateStats('download');
                }
                
                if (results.length > 5) {
                    ctx.reply(`... va yana ${results.length - 5} ta fayl`);
                }
            } else {
                ctx.reply(
                    `❌ <b>Hech narsa topilmadi</b>\n\n` +
                    `So'rov: <code>${text}</code>\n\n` +
                    `💡 Maslahat: Boshqa so'z yoki fayl nomini sinab ko'ring.`,
                    { parse_mode: 'HTML' }
                );
            }
        }
    } catch (error) {
        console.error('Matn qayta ishlashda xato:', error);
        ctx.reply('❌ Xatolik yuz berdi. Iltimos, qaytadan urinib ko\'ring.');
    }
});

// --- CALLBACK HANDLERS (TUGMALAR UCHUN) ---

// Eksport qilish
bot.action('export_data', async (ctx) => {
    try {
        const userId = ctx.from.id.toString();
        const db = loadData(DB_FILE);
        const userData = db[userId] || {};

        if (Object.keys(userData).length === 0) {
            return ctx.answerCbQuery("❌ Sizda eksport qilish uchun ma'lumot yo'q.");
        }

        const exportData = {
            user_info: loadData(USERS_FILE)[userId],
            files: userData,
            export_date: new Date().toISOString()
        };

        const buffer = Buffer.from(JSON.stringify(exportData, null, 2));
        
        await ctx.replyWithDocument(
            { source: buffer, filename: `devvault_backup_${userId}_${Date.now()}.json` },
            { caption: "📊 Sizning barcha ma'lumotlaringiz (JSON formatida)" }
        );
        
        ctx.answerCbQuery("✅ Eksport muvaffaqiyatli");
    } catch (error) {
        console.error('Eksport xatosi:', error);
        ctx.answerCbQuery("❌ Eksport qilishda xatolik");
    }
});

// O'chirish tasdiqlash
bot.action('clear_all_confirm', (ctx) => {
    ctx.editMessageText(
        "⚠️ <b>DIQQAT!</b>\n\n" +
        "Barcha fayllaringizni o'chirib tashlamoqchimisiz?\n\n" +
        "❗️ Bu amalni ortga qaytarib bo'lmaydi!\n" +
        "❗️ Barcha fayllar, teglar va tavsiflar o'chib ketadi.",
        {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('✅ Ha, barchasini o\'chir', 'clear_all_execute')],
                [Markup.button.callback('❌ Yo\'q, bekor qilish', 'cancel_clear')]
            ])
        }
    );
    ctx.answerCbQuery();
});

// O'chirishni bajarish
bot.action('clear_all_execute', (ctx) => {
    try {
        const userId = ctx.from.id.toString();

        // DB dan o'chirish
        const db = loadData(DB_FILE);
        const fileCount = db[userId] ? Object.keys(db[userId]).length : 0;
        
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

        ctx.editMessageText(
            `🗑 <b>Barcha ma'lumotlar o'chirildi</b>\n\n` +
            `O'chirilgan fayllar: ${fileCount} ta\n\n` +
            `Yangi fayllar yuklash uchun tayyor!`,
            { parse_mode: 'HTML' }
        );
        
        ctx.answerCbQuery("✅ Barcha ma'lumotlar o'chirildi");
    } catch (error) {
        console.error('O\'chirishda xato:', error);
        ctx.answerCbQuery("❌ O'chirishda xatolik");
    }
});

// Bekor qilish
bot.action('cancel_clear', (ctx) => {
    ctx.editMessageText(
        "❌ Amal bekor qilindi.\n\n" +
        "Fayllaringiz saqlanib qoldi.",
        { parse_mode: 'HTML' }
    );
    ctx.answerCbQuery("Bekor qilindi");
});

// Teg qo'shish
bot.action(/tag_(.+)/, (ctx) => {
    const fileKey = ctx.match[1];
    userSessions[ctx.from.id] = { action: 'waiting_tag', fileKey };
    
    ctx.reply(
        "🏷 <b>Teg qo'shish</b>\n\n" +
        "Teglarni vergul bilan ajratib yozing.\n\n" +
        "Misol: <code>ish, muhim, prezentatsiya</code>",
        { parse_mode: 'HTML' }
    );
    ctx.answerCbQuery();
});

// Tavsif qo'shish
bot.action(/desc_(.+)/, (ctx) => {
    const fileKey = ctx.match[1];
    userSessions[ctx.from.id] = { action: 'waiting_desc', fileKey };
    
    ctx.reply(
        "📝 <b>Tavsif qo'shish</b>\n\n" +
        "Fayl uchun tavsif yozing.\n\n" +
        "Misol: <i>Q4 moliyaviy hisobot - 2024</i>",
        { parse_mode: 'HTML' }
    );
    ctx.answerCbQuery();
});

// Sevimliga qo'shish/olish
bot.action(/fav_(.+)/, (ctx) => {
    try {
        const db = loadData(DB_FILE);
        const userId = ctx.from.id.toString();
        const fileKey = ctx.match[1];
        
        if (db[userId] && db[userId][fileKey]) {
            db[userId][fileKey].is_favorite = !db[userId][fileKey].is_favorite;
            saveData(DB_FILE, db);
            
            const isFav = db[userId][fileKey].is_favorite;
            ctx.answerCbQuery(isFav ? "⭐ Sevimlilarga qo'shildi" : "Sevimlilardan olib tashlandi");
        } else {
            ctx.answerCbQuery("❌ Fayl topilmadi");
        }
    } catch (error) {
        console.error('Sevimli xatosi:', error);
        ctx.answerCbQuery("❌ Xatolik yuz berdi");
    }
});

// O'chirish
bot.action(/del_(.+)/, (ctx) => {
    try {
        const db = loadData(DB_FILE);
        const userId = ctx.from.id.toString();
        const fileKey = ctx.match[1];
        
        if (db[userId] && db[userId][fileKey]) {
            const fileName = db[userId][fileKey].name;
            const size = db[userId][fileKey].size || 0;
            
            delete db[userId][fileKey];
            saveData(DB_FILE, db);
            
            // Statistikani yangilash
            const users = loadData(USERS_FILE);
            if (users[userId]) {
                users[userId].total_files = Math.max(0, (users[userId].total_files || 1) - 1);
                users[userId].storage_used = Math.max(0, (users[userId].storage_used || size) - size);
                saveData(USERS_FILE, users);
            }
            
            ctx.deleteMessage().catch(() => {});
            ctx.answerCbQuery(`🗑 ${fileName} o'chirildi`);
        } else {
            ctx.answerCbQuery("❌ Fayl topilmadi");
        }
    } catch (error) {
        console.error('O\'chirish xatosi:', error);
        ctx.answerCbQuery("❌ O'chirishda xatolik");
    }
});

// Kategoriyalarni ko'rsatish
bot.action('show_cats', (ctx) => {
    try {
        const db = loadData(DB_FILE);
        const userFiles = db[ctx.from.id] || {};
        
        let cats = {};
        Object.values(userFiles).forEach(f => {
            cats[f.category] = (cats[f.category] || 0) + 1;
        });
        
        if (Object.keys(cats).length === 0) {
            return ctx.answerCbQuery("❌ Kategoriyalar bo'sh");
        }
        
        let btns = Object.entries(cats)
            .sort((a, b) => b[1] - a[1])
            .map(([c, n]) => [Markup.button.callback(`${c} (${n} ta)`, `viewcat_${c}`)]);
        
        ctx.editMessageText(
            "📁 <b>Fayllar kategoriya bo'yicha:</b>",
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard(btns)
            }
        );
        ctx.answerCbQuery();
    } catch (error) {
        console.error('Kategoriya xatosi:', error);
        ctx.answerCbQuery("❌ Xatolik yuz berdi");
    }
});

// Sevimlilarni ko'rsatish
bot.action('show_favs', async (ctx) => {
    try {
        const db = loadData(DB_FILE);
        const userFiles = db[ctx.from.id] || {};
        
        const favorites = Object.entries(userFiles).filter(([_, f]) => f.is_favorite);
        
        if (favorites.length === 0) {
            return ctx.answerCbQuery("❌ Sevimli fayllar yo'q");
        }
        
        await ctx.reply(`⭐ <b>Sevimli fayllar (${favorites.length} ta):</b>`, { parse_mode: 'HTML' });
        
        for (const [key, f] of favorites.slice(0, 10)) {
            await ctx.sendDocument(f.file_id, {
                caption: 
                    `⭐ <b>${f.name}</b>\n\n` +
                    `📁 ${f.category} • 📦 ${f.size_formatted}\n` +
                    `📅 ${f.date}`,
                parse_mode: 'HTML'
            });
        }
        
        ctx.answerCbQuery();
    } catch (error) {
        console.error('Sevimlilar xatosi:', error);
        ctx.answerCbQuery("❌ Xatolik yuz berdi");
    }
});

// Kategoriya bo'yicha ko'rish
bot.action(/viewcat_(.+)/, async (ctx) => {
    try {
        const category = ctx.match[1];
        const db = loadData(DB_FILE);
        const userFiles = db[ctx.from.id] || {};
        
        const catFiles = Object.entries(userFiles).filter(([_, f]) => f.category === category);
        
        if (catFiles.length === 0) {
            return ctx.answerCbQuery("❌ Bu kategoriyada fayllar yo'q");
        }
        
        await ctx.reply(`📁 <b>${category} (${catFiles.length} ta):</b>`, { parse_mode: 'HTML' });
        
        for (const [key, f] of catFiles.slice(0, 10)) {
            await ctx.sendDocument(f.file_id, {
                caption: `<b>${f.name}</b>\n📦 ${f.size_formatted} • 📅 ${f.date}`,
                parse_mode: 'HTML'
            });
        }
        
        ctx.answerCbQuery();
    } catch (error) {
        console.error('Kategoriya ko\'rish xatosi:', error);
        ctx.answerCbQuery("❌ Xatolik yuz berdi");
    }
});

// Teg bo'yicha qidirish
bot.action(/searchtag_(.+)/, async (ctx) => {
    try {
        const tag = ctx.match[1];
        const db = loadData(DB_FILE);
        const userFiles = db[ctx.from.id] || {};
        
        const taggedFiles = Object.entries(userFiles).filter(([_, f]) => 
            f.tags && f.tags.includes(tag)
        );
        
        if (taggedFiles.length === 0) {
            return ctx.answerCbQuery(`❌ #${tag} tegi bo'yicha fayllar topilmadi`);
        }
        
        await ctx.reply(`🏷 <b>#${tag}</b> (${taggedFiles.length} ta)`, { parse_mode: 'HTML' });
        
        for (const [key, f] of taggedFiles.slice(0, 10)) {
            await ctx.sendDocument(f.file_id, {
                caption: `<b>${f.name}</b>\n📁 ${f.category} • 📦 ${f.size_formatted}`,
                parse_mode: 'HTML'
            });
        }
        
        ctx.answerCbQuery();
    } catch (error) {
        console.error('Teg qidiruv xatosi:', error);
        ctx.answerCbQuery("❌ Xatolik yuz berdi");
    }
});

// Admin: Top foydalanuvchilar
bot.action('adm_users', async (ctx) => {
    try {
        if (!isAdmin(ctx.from.id)) {
            return ctx.answerCbQuery("❌ Sizda ruxsat yo'q");
        }
        
        const usersData = loadData(USERS_FILE);
        const users = Object.values(usersData)
            .sort((a, b) => b.total_files - a.total_files)
            .slice(0, 10);
        
        let msg = "👥 <b>Top 10 Foydalanuvchi:</b>\n\n";
        
        users.forEach((u, i) => {
            msg += `${i + 1}. <b>${u.first_name}</b> (@${u.username})\n`;
            msg += `   📁 ${u.total_files} fayl • 💾 ${formatFileSize(u.storage_used)}\n\n`;
        });
        
        await ctx.replyWithHTML(msg);
        ctx.answerCbQuery();
    } catch (error) {
        console.error('Admin users xatosi:', error);
        ctx.answerCbQuery("❌ Xatolik yuz berdi");
    }
});

// Admin: Batafsil statistika
bot.action('adm_stats', async (ctx) => {
    try {
        if (!isAdmin(ctx.from.id)) {
            return ctx.answerCbQuery("❌ Sizda ruxsat yo'q");
        }
        
        const stats = loadData(STATS_FILE);
        const users = loadData(USERS_FILE);
        const db = loadData(DB_FILE);
        
        // Eng ko'p ishlatiladigan kategoriyalar
        let allCategories = {};
        Object.values(db).forEach(userFiles => {
            Object.values(userFiles).forEach(f => {
                allCategories[f.category] = (allCategories[f.category] || 0) + 1;
            });
        });
        
        const topCategories = Object.entries(allCategories)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([cat, count]) => `${cat}: ${count} ta`)
            .join('\n');
        
        const msg = 
            `📊 <b>BATAFSIL STATISTIKA</b>\n\n` +
            `👥 Jami foydalanuvchilar: ${Object.keys(users).length}\n` +
            `📁 Jami fayllar: ${stats.total_uploads || 0}\n` +
            `💾 Umumiy hajm: ${formatFileSize(stats.total_storage || 0)}\n` +
            `🔍 Qidiruvlar: ${stats.total_searches || 0}\n` +
            `📥 Yuklashlar: ${stats.total_downloads || 0}\n\n` +
            `📊 <b>Top kategoriyalar:</b>\n${topCategories}`;
        
        await ctx.replyWithHTML(msg);
        ctx.answerCbQuery();
    } catch (error) {
        console.error('Admin stats xatosi:', error);
        ctx.answerCbQuery("❌ Xatolik yuz berdi");
    }
});

// Xatolarni tutish
bot.catch((err, ctx) => {
    console.error(`❌ Xatolik [${ctx.updateType}]:`, err);
    
    if (ctx && ctx.reply) {
        ctx.reply('❌ Tizimda xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko\'ring.')
            .catch(() => {});
    }
});

// Botni ishga tushirish
bot.launch({
    dropPendingUpdates: true, // ✅ Eski update'larni avtomatik tozalash
    allowedUpdates: [] // Barcha update turlarini qabul qilish
})
.then(() => {
    console.log('✅ DevVault bot muvaffaqiyatli ishga tushdi!');
    console.log(`📅 Vaqt: ${new Date().toLocaleString('uz-UZ')}`);
})
.catch(err => {
    console.error('❌ Bot ishga tushmadi:', err);
    process.exit(1);
});

// Graceful shutdown
process.once('SIGINT', () => {
    console.log('\n⏹ Bot to\'xtatilmoqda...');
    bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
    console.log('\n⏹ Bot to\'xtatilmoqda...');
    bot.stop('SIGTERM');
});
