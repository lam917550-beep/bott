// ============================================================
// LASTFINAL — FULL ULTRA MAX TELEGRAM BOT + MINI APP
// File: bot.js
// Đã sửa mọi lỗi cú pháp, đầy đủ tính năng
// ============================================================

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const cron = require('node-cron');

// ======================= CONFIGURATION =======================
const ENV = {
  TELEGRAM_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
  PORT: process.env.PORT || 3000,
  HOST: process.env.HOST || '0.0.0.0',
  DB_PATH: process.env.DB_PATH || path.join(__dirname, 'superbot.db'),
  OWNER_ID: process.env.OWNER_TELEGRAM_ID || '',
  WEBAPP_URL: process.env.WEBAPP_URL || '',
  STARTING_BALANCE: parseInt(process.env.STARTING_BALANCE || '10000'),
  PLAYER_WIN_RATE: parseFloat(process.env.PLAYER_WIN_RATE || '0.45'),
};

if (!ENV.TELEGRAM_TOKEN) {
  console.error('[FATAL] TELEGRAM_BOT_TOKEN missing');
  process.exit(1);
}

// ======================= LOGGING =======================
const Logger = {
  info: (...args) => console.log(`[INFO] ${new Date().toISOString()}`, ...args),
  warn: (...args) => console.warn(`[WARN] ${new Date().toISOString()}`, ...args),
  error: (...args) => console.error(`[ERROR] ${new Date().toISOString()}`, ...args),
};

// ======================= UTILITIES =======================
function sanitizeInput(str) {
  return typeof str === 'string' ? str.replace(/[<>]/g, '').trim() : '';
}
function generateId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function isOwner(userId) {
  return ENV.OWNER_ID && String(userId) === String(ENV.OWNER_ID);
}

// ======================= RATE LIMITER =======================
class RateLimiter {
  constructor() {
    this.store = new Map();
  }
  check(key, limit, windowMs) {
    const now = Date.now();
    const record = this.store.get(key);
    if (!record || now > record.resetTime) {
      this.store.set(key, { count: 1, resetTime: now + windowMs });
      return true;
    }
    if (record.count >= limit) return false;
    record.count++;
    return true;
  }
  cleanup() {
    const now = Date.now();
    for (const [key, rec] of this.store.entries()) {
      if (now > rec.resetTime) this.store.delete(key);
    }
  }
}

// ======================= I18N =======================
const translations = {
  vi: {
    welcome: '👋 Chào mừng {name}!',
    help_title: '📚 Danh sách lệnh (Trang {page}/{total})',
    cooldown: '⏳ Bạn đang sử dụng lệnh quá nhanh.',
    error: '❌ Đã xảy ra lỗi.',
    ai_ask: 'Vui lòng nhập câu hỏi.',
    ai_error: 'AI hiện không khả dụng.',
    img_ask: 'Vui lòng nhập mô tả ảnh.',
    img_error: 'Không thể tạo ảnh.',
    language_set: '✅ Ngôn ngữ đã đổi thành {lang}.',
    language_menu: '🌐 Chọn ngôn ngữ:',
    footer: 'Chủ bot @itznvl • Hãy Chia Sẻ Bot Cho Mọi Người Nhé ❤️',
    redeem_usage: 'Cách dùng: /redeem <mã>',
    redeem_success: '🎉 Bạn nhận được {amount} xu!',
    redeem_invalid: 'Mã không hợp lệ hoặc đã dùng.',
    owner_only: '⛔ Bạn không có quyền.',
    page: 'Trang',
    next: '▶️',
    prev: '◀️',
    home: '🏠',
    search: '🔍',
    pet_stats: '🐾 {name} ({type}) - {rarity}\nLevel: {level} | XP: {xp}\nHappiness: {happiness} | Energy: {energy}\nHunger: {hunger} | Cleanliness: {cleanliness}',
  },
  en: {
    welcome: '👋 Welcome {name}!',
    help_title: '📚 Commands (Page {page}/{total})',
    cooldown: '⏳ Too fast.',
    error: '❌ Error occurred.',
    ai_ask: 'Enter question.',
    ai_error: 'AI unavailable.',
    img_ask: 'Enter image description.',
    img_error: 'Cannot generate image.',
    language_set: '✅ Language changed to {lang}.',
    language_menu: '🌐 Select language:',
    footer: 'Bot owner @itznvl • Please share the bot ❤️',
    redeem_usage: 'Usage: /redeem <code>',
    redeem_success: '🎉 You got {amount} coins!',
    redeem_invalid: 'Invalid or used code.',
    owner_only: '⛔ Permission denied.',
    page: 'Page',
    next: '▶️',
    prev: '◀️',
    home: '🏠',
    search: '🔍',
    pet_stats: '🐾 {name} ({type}) - {rarity}\nLevel: {level} | XP: {xp}\nHappiness: {happiness} | Energy: {energy}\nHunger: {hunger} | Cleanliness: {cleanliness}',
  },
};

const LANGUAGES = ['vi', 'en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'ru', 'pt'];
for (const lang of LANGUAGES) {
  if (!translations[lang]) translations[lang] = { ...translations.en };
}

const userLanguages = new Map();
function getValidLanguage(lang) {
  return LANGUAGES.includes(lang) ? lang : 'vi';
}
function getUserLanguage(userId) {
  return userLanguages.get(String(userId)) || 'vi';
}
function setUserLanguage(userId, lang) {
  const v = getValidLanguage(lang);
  userLanguages.set(String(userId), v);
  return v;
}
function t(lang, key, params = {}) {
  const pack = translations[lang] || translations.en;
  let text = pack[key] || translations.en[key] || key;
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(new RegExp(`{${k}}`, 'g'), String(v));
  }
  return text;
}
function addFooter(text, lang) {
  return text + '\n\n' + t(lang, 'footer');
}

// ======================= AI SERVICE =======================
class GeminiProvider {
  constructor(apiKey) {
    this.genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
    this.conversations = new Map();
    this.maxHistory = 10;
    this.rateLimiter = new RateLimiter();
  }
  async generateText(prompt, userId) {
    if (!this.genAI) throw new Error('GEMINI_API_KEY not configured');
    const key = 'ai_' + (userId || 'anon');
    if (!this.rateLimiter.check(key, 10, 60000)) throw new Error('Rate limit');
    const model = this.genAI.getGenerativeModel({ model: 'gemini-pro' });
    let history = userId ? (this.conversations.get(userId) || []) : [];
    history.push({ role: 'user', content: prompt });
    const fullPrompt = history.map(m => m.role + ': ' + m.content).join('\n') + '\nassistant:';
    try {
      const result = await Promise.race([
        model.generateContent(fullPrompt),
        sleep(20000).then(() => { throw new Error('timeout'); })
      ]);
      const response = await result.response;
      const text = response.text();
      history.push({ role: 'assistant', content: text });
      if (userId) this.conversations.set(userId, history.slice(-this.maxHistory * 2));
      return text;
    } catch (e) {
      Logger.error('Gemini error:', e.message);
      throw new Error('AI service error');
    }
  }
  async generateImage(prompt) {
    try {
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true`;
      const response = await axios.get(url, { timeout: 30000, responseType: 'arraybuffer' });
      return Buffer.from(response.data);
    } catch (e) {
      Logger.error('Image error:', e.message);
      throw new Error('Image generation failed');
    }
  }
}

const aiProvider = new GeminiProvider(ENV.GEMINI_API_KEY);

// ======================= DATABASE =======================
let db;
async function initDatabase() {
  db = await open({ filename: ENV.DB_PATH, driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      telegram_id TEXT UNIQUE,
      language TEXT DEFAULT 'vi',
      points INTEGER DEFAULT ${ENV.STARTING_BALANCE},
      level INTEGER DEFAULT 1,
      xp INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS pets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT DEFAULT 'Pet',
      type TEXT DEFAULT '🐶',
      rarity TEXT DEFAULT 'Common',
      level INTEGER DEFAULT 1,
      xp INTEGER DEFAULT 0,
      happiness INTEGER DEFAULT 100,
      energy INTEGER DEFAULT 100,
      hunger INTEGER DEFAULT 0,
      cleanliness INTEGER DEFAULT 100,
      health INTEGER DEFAULT 100,
      bond INTEGER DEFAULT 0,
      evolution_stage INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS redeem_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      amount INTEGER NOT NULL,
      used INTEGER DEFAULT 0,
      max_uses INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      token TEXT,
      expires_at DATETIME
    );
    CREATE TABLE IF NOT EXISTS game_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      game_id TEXT,
      bet_amount INTEGER,
      result TEXT,
      payout INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      quest_type TEXT,
      progress INTEGER DEFAULT 0,
      completed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS achievements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      achievement_key TEXT,
      progress INTEGER DEFAULT 0,
      unlocked INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      item_key TEXT,
      quantity INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  Logger.info('Database initialized');
}

// ======================= AUTH =======================
class AuthService {
  async register(username, email, password) {
    if (!username || username.length < 3) throw new Error('Username too short');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email');
    if (!password || password.length < 8) throw new Error('Weak password');
    const exists = await db.get('SELECT id FROM users WHERE username = ? OR email = ?', [username, email || null]);
    if (exists) throw new Error('User exists');
    const hash = await bcrypt.hash(password, 12);
    const result = await db.run('INSERT INTO users (username, email, password_hash, points) VALUES (?, ?, ?, ?)', [username, email || null, hash, ENV.STARTING_BALANCE]);
    return { id: result.lastID, username };
  }
  async login(username, password) {
    const user = await db.get('SELECT * FROM users WHERE username = ? OR email = ?', [username, username]);
    if (!user) throw new Error('Invalid credentials');
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) throw new Error('Invalid credentials');
    const token = jwt.sign({ userId: user.id }, ENV.JWT_SECRET, { expiresIn: '7d' });
    await db.run('INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)', [generateId('sess'), user.id, token, new Date(Date.now() + 7 * 86400000).toISOString()]);
    return { token, user: { id: user.id, username: user.username, points: user.points, level: user.level } };
  }
  async verifyToken(token) {
    try {
      const decoded = jwt.verify(token, ENV.JWT_SECRET);
      const session = await db.get('SELECT * FROM sessions WHERE token = ? AND expires_at > ?', [token, new Date().toISOString()]);
      if (!session) return null;
      const user = await db.get('SELECT * FROM users WHERE id = ?', [decoded.userId]);
      return user ? { userId: user.id, username: user.username, points: user.points } : null;
    } catch (e) {
      return null;
    }
  }
}
const authService = new AuthService();

// ======================= GAME ENGINE =======================
class GameEngine {
  constructor() {
    this.games = [];
    this.generateGames();
  }
  generateGames() {
    const templates = [
      { prefix: 'Dice', category: 'dice', options: ['1', '2', '3', '4', '5', '6'], minBet: 10, maxBet: 1000 },
      { prefix: 'Card', category: 'cards', options: ['High', 'Low'], minBet: 20, maxBet: 2000 },
      { prefix: 'Number', category: 'number', options: ['Odd', 'Even'], minBet: 5, maxBet: 500 },
      { prefix: 'Wheel', category: 'wheel', options: ['Red', 'Black'], minBet: 10, maxBet: 1000 },
      { prefix: 'Memory', category: 'memory', options: ['Pair', 'NoPair'], minBet: 5, maxBet: 200 },
    ];
    let id = 1;
    for (let i = 0; i < 500; i++) {
      const tpl = templates[i % templates.length];
      this.games.push({
        id: id++,
        name: `${tpl.prefix} #${i + 1}`,
        category: tpl.category,
        options: tpl.options,
        minBet: tpl.minBet,
        maxBet: tpl.maxBet,
        description: `${tpl.prefix} game`,
      });
    }
  }
  getGames(page, pageSize) {
    page = page || 1;
    pageSize = pageSize || 20;
    const start = (page - 1) * pageSize;
    return {
      total: this.games.length,
      page,
      pageSize,
      games: this.games.slice(start, start + pageSize),
    };
  }
  play(gameId, amount, choice) {
    const game = this.games.find(g => g.id === gameId);
    if (!game) return { error: 'Game not found' };
    const bet = parseInt(amount);
    if (isNaN(bet) || bet < game.minBet || bet > game.maxBet) return { error: 'Invalid bet' };
    const random = crypto.randomBytes(4).readUInt32LE(0) / 0xFFFFFFFF;
    const playerWins = random < ENV.PLAYER_WIN_RATE;
    const resultOption = playerWins ? choice : game.options.find(o => o !== choice) || game.options[0];
    const payout = playerWins ? bet * 2 : 0;
    return {
      roundId: generateId('round'),
      gameId,
      gameName: game.name,
      betAmount: bet,
      choice,
      resultOption,
      playerWins,
      payout,
    };
  }
}
const gameEngine = new GameEngine();

// ======================= PET SYSTEM =======================
class PetSystem {
  async getPet(userId) {
    return await db.get('SELECT * FROM pets WHERE user_id = ?', [userId]);
  }
  async createDefault(userId) {
    const existing = await this.getPet(userId);
    if (existing) return existing;
    await db.run('INSERT INTO pets (user_id, name, type) VALUES (?, ?, ?)', [userId, 'Cún', '🐶']);
    return this.getPet(userId);
  }
  async feed(userId) {
    const pet = await this.getPet(userId);
    if (!pet) return null;
    pet.hunger = Math.max(0, pet.hunger - 20);
    pet.happiness = Math.min(100, pet.happiness + 5);
    await db.run('UPDATE pets SET hunger=?, happiness=? WHERE id=?', [pet.hunger, pet.happiness, pet.id]);
    return pet;
  }
  async play(userId) {
    const pet = await this.getPet(userId);
    if (!pet) return null;
    pet.energy = Math.max(0, pet.energy - 10);
    pet.happiness = Math.min(100, pet.happiness + 15);
    pet.bond = pet.bond + 1;
    await db.run('UPDATE pets SET energy=?, happiness=?, bond=? WHERE id=?', [pet.energy, pet.happiness, pet.bond, pet.id]);
    return pet;
  }
  async train(userId) {
    const pet = await this.getPet(userId);
    if (!pet) return null;
    pet.xp = pet.xp + 10;
    pet.bond = pet.bond + 2;
    if (pet.xp >= pet.level * 50) {
      pet.xp = 0;
      pet.level = pet.level + 1;
      pet.happiness = Math.min(100, pet.happiness + 10);
    }
    await db.run('UPDATE pets SET xp=?, level=?, happiness=?, bond=? WHERE id=?', [pet.xp, pet.level, pet.happiness, pet.bond, pet.id]);
    return pet;
  }
  async evolve(userId) {
    const pet = await this.getPet(userId);
    if (!pet) return null;
    if (pet.evolution_stage < 5 && pet.level >= 10) {
      pet.evolution_stage += 1;
      pet.rarity = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'][pet.evolution_stage - 1] || 'Legendary';
      await db.run('UPDATE pets SET evolution_stage=?, rarity=? WHERE id=?', [pet.evolution_stage, pet.rarity, pet.id]);
    }
    return pet;
  }
}
const petSystem = new PetSystem();

// ======================= COMMAND REGISTRY =======================
class CommandRegistry {
  constructor() {
    this.commands = new Map();
    this.aliases = new Map();
  }
  register(cmd) {
    const { name, handler, description = '', category = 'general', aliases = [], ownerOnly = false } = cmd;
    if (this.commands.has(name)) return false;
    this.commands.set(name, { handler, description, category, aliases, ownerOnly });
    for (const a of aliases) this.aliases.set(a, name);
    return true;
  }
  resolve(name) {
    const n = name.toLowerCase();
    return this.commands.get(n) || this.commands.get(this.aliases.get(n) || '');
  }
  getAll(includeOwner) {
    return Array.from(this.commands.entries())
      .filter(([name, meta]) => includeOwner || !meta.ownerOnly)
      .map(([name, meta]) => ({ name, ...meta }));
  }
}
const commandRegistry = new CommandRegistry();
const helpPageState = new Map();

// ======================= REGISTER COMMANDS =======================
function registerCommands() {
  commandRegistry.register({
    name: '/start', description: 'Khởi động bot', category: 'core',
    handler: async (msg) => {
      const lang = getUserLanguage(msg.from.id);
      let text = t(lang, 'welcome', { name: msg.from.first_name });
      text = addFooter(text, lang);
      const keyboard = [
        [{ text: '🤖 AI', callback_data: 'menu_ai' }, { text: '🎮 Game', callback_data: 'menu_game' }],
        [{ text: '🐾 Pet', callback_data: 'menu_pet' }, { text: '🏆 BXH', callback_data: 'menu_leaderboard' }],
        [{ text: '👤 Profile', callback_data: 'menu_profile' }, { text: '🌐 Language', callback_data: 'menu_language' }],
        [{ text: '🚀 Open Mini App', url: ENV.WEBAPP_URL || 'https://t.me/' + bot.username + '/app' }],
      ];
      bot.sendMessage(msg.chat.id, text, { reply_markup: { inline_keyboard: keyboard } });
    }
  });

  commandRegistry.register({
    name: '/help', description: 'Danh sách lệnh', category: 'core',
    handler: async (msg) => {
      const lang = getUserLanguage(msg.from.id);
      const all = commandRegistry.getAll(false);
      const pageSize = 10;
      const totalPages = Math.ceil(all.length / pageSize);
      let page = helpPageState.get(msg.from.id) || 1;
      if (page < 1) page = 1;
      if (page > totalPages) page = totalPages;
      helpPageState.set(msg.from.id, page);
      const start = (page - 1) * pageSize;
      const pageCommands = all.slice(start, start + pageSize);
      let text = t(lang, 'help_title', { page, total: totalPages }) + '\n\n';
      pageCommands.forEach(cmd => text += '/' + cmd.name + ' - ' + cmd.description + '\n');
      text += '\n' + t(lang, 'prev') + '  ' + t(lang, 'page') + ' ' + page + '/' + totalPages + '  ' + t(lang, 'next');
      text = addFooter(text, lang);
      const keyboard = [
        [{ text: t(lang, 'prev'), callback_data: 'help_prev' }, { text: t(lang, 'next'), callback_data: 'help_next' }],
        [{ text: t(lang, 'home'), callback_data: 'help_home' }, { text: t(lang, 'search'), callback_data: 'help_search' }],
      ];
      bot.sendMessage(msg.chat.id, text, { reply_markup: { inline_keyboard: keyboard } });
    }
  });

  commandRegistry.register({
    name: '/language', description: 'Đổi ngôn ngữ', category: 'core',
    handler: async (msg) => {
      const lang = getUserLanguage(msg.from.id);
      const keyboard = LANGUAGES.map(l => [{ text: t(l, 'lang_' + l), callback_data: 'lang:' + l }]);
      bot.sendMessage(msg.chat.id, t(lang, 'language_menu'), { reply_markup: { inline_keyboard: keyboard } });
    }
  });

  commandRegistry.register({
    name: '/game', description: 'Mở Mini App', category: 'game',
    handler: async (msg) => {
      const lang = getUserLanguage(msg.from.id);
      const url = ENV.WEBAPP_URL || 'https://t.me/' + bot.username + '/app';
      const text = '🎮 Game Center\n\n- Chơi game\n- BXH\n- Pet\n- Quest\n- Profile\n\nNhấn nút bên dưới để mở Mini App:';
      const keyboard = [[{ text: '🚀 Mở Mini App', url }]];
      bot.sendMessage(msg.chat.id, addFooter(text, lang), { reply_markup: { inline_keyboard: keyboard } });
    }
  });

  const aiCommands = ['ai', 'ask', 'chat', 'explain', 'summarize', 'rewrite', 'translate', 'code', 'idea', 'story', 'caption'];
  for (const cmd of aiCommands) {
    commandRegistry.register({
      name: '/' + cmd, description: 'AI ' + cmd, category: 'ai',
      handler: async (msg) => {
        const lang = getUserLanguage(msg.from.id);
        const prompt = msg.text.replace(new RegExp('^/' + cmd + '\\s*'), '').trim();
        if (!prompt) return bot.sendMessage(msg.chat.id, t(lang, 'ai_ask'));
        await bot.sendChatAction(msg.chat.id, 'typing');
        try {
          const answer = await aiProvider.generateText(prompt, msg.from.id);
          bot.sendMessage(msg.chat.id, answer);
        } catch (e) {
          bot.sendMessage(msg.chat.id, t(lang, 'ai_error'));
        }
      }
    });
  }

  commandRegistry.register({
    name: '/img', description: 'Tạo ảnh', category: 'ai', aliases: ['/imagine'],
    handler: async (msg) => {
      const lang = getUserLanguage(msg.from.id);
      const prompt = msg.text.replace(/^\/(img|imagine)\s*/, '').trim();
      if (!prompt) return bot.sendMessage(msg.chat.id, t(lang, 'img_ask'));
      await bot.sendChatAction(msg.chat.id, 'upload_photo');
      try {
        const imageBuffer = await aiProvider.generateImage(prompt);
        await bot.sendPhoto(msg.chat.id, imageBuffer);
      } catch (e) {
        bot.sendMessage(msg.chat.id, t(lang, 'img_error'));
      }
    }
  });

  commandRegistry.register({
    name: '/pet', description: 'Xem thú cưng', category: 'pet',
    handler: async (msg) => {
      const lang = getUserLanguage(msg.from.id);
      const pet = await petSystem.getPet(msg.from.id) || await petSystem.createDefault(msg.from.id);
      const text = t(lang, 'pet_stats', pet);
      bot.sendMessage(msg.chat.id, addFooter(text, lang));
    }
  });

  commandRegistry.register({
    name: '/redeem', description: 'Nhập code lấy xu', category: 'economy',
    handler: async (msg) => {
      const lang = getUserLanguage(msg.from.id);
      const code = msg.text.split(' ')[1];
      if (!code) return bot.sendMessage(msg.chat.id, t(lang, 'redeem_usage'));
      const record = await db.get('SELECT * FROM redeem_codes WHERE code = ? AND used < max_uses', [code]);
      if (!record) return bot.sendMessage(msg.chat.id, t(lang, 'redeem_invalid'));
      await db.run('UPDATE redeem_codes SET used = used + 1 WHERE id = ?', [record.id]);
      await db.run('UPDATE users SET points = points + ? WHERE id = ?', [record.amount, msg.from.id]);
      bot.sendMessage(msg.chat.id, t(lang, 'redeem_success', { amount: record.amount }));
    }
  });

  commandRegistry.register({
    name: '/games', description: 'Danh sách game', category: 'game',
    handler: async (msg) => {
      const lang = getUserLanguage(msg.from.id);
      const games = gameEngine.getGames(1, 5).games;
      const text = '🎮 Games:\n' + games.map(g => '- ' + g.name).join('\n');
      bot.sendMessage(msg.chat.id, addFooter(text, lang));
    }
  });

  // Owner commands
  commandRegistry.register({
    name: '/ownerhelp', description: 'Lệnh Admin', category: 'owner', ownerOnly: true,
    handler: async (msg) => {
      if (!isOwner(msg.from.id)) return bot.sendMessage(msg.chat.id, t(getUserLanguage(msg.from.id), 'owner_only'));
      bot.sendMessage(msg.chat.id, '🔐 Lệnh Admin:\n/gencode <số xu> <số lượng> - Tạo mã code\n/delcode <mã> - Xóa mã\n/listcodes - Danh sách mã\n/ownerstats - Thống kê');
    }
  });
  commandRegistry.register({
    name: '/gencode', description: 'Tạo mã code', category: 'owner', ownerOnly: true,
    handler: async (msg) => {
      if (!isOwner(msg.from.id)) return bot.sendMessage(msg.chat.id, t(getUserLanguage(msg.from.id), 'owner_only'));
      const args = msg.text.split(' ');
      const amount = parseInt(args[1]);
      const count = parseInt(args[2]) || 1;
      if (!amount || amount <= 0) return bot.sendMessage(msg.chat.id, 'Usage: /gencode <amount> <count>');
      const codes = [];
      for (let i = 0; i < count; i++) {
        const code = generateId('code').toUpperCase();
        await db.run('INSERT INTO redeem_codes (code, amount, max_uses) VALUES (?, ?, 1)', [code, amount]);
        codes.push(code);
      }
      bot.sendMessage(msg.chat.id, 'Đã tạo ' + count + ' code:\n' + codes.join('\n'));
    }
  });
  commandRegistry.register({
    name: '/delcode', description: 'Xóa mã code', category: 'owner', ownerOnly: true,
    handler: async (msg) => {
      if (!isOwner(msg.from.id)) return bot.sendMessage(msg.chat.id, t(getUserLanguage(msg.from.id), 'owner_only'));
      const code = msg.text.split(' ')[1];
      if (!code) return bot.sendMessage(msg.chat.id, 'Usage: /delcode <code>');
      await db.run('DELETE FROM redeem_codes WHERE code = ?', [code]);
      bot.sendMessage(msg.chat.id, 'Đã xóa code');
    }
  });
  commandRegistry.register({
    name: '/listcodes', description: 'Danh sách code', category: 'owner', ownerOnly: true,
    handler: async (msg) => {
      if (!isOwner(msg.from.id)) return bot.sendMessage(msg.chat.id, t(getUserLanguage(msg.from.id), 'owner_only'));
      const codes = await db.all('SELECT * FROM redeem_codes ORDER BY created_at DESC LIMIT 20');
      if (codes.length === 0) return bot.sendMessage(msg.chat.id, 'Chưa có code');
      let text = 'Danh sách code:\n';
      for (const c of codes) text += c.code + ' - ' + c.amount + ' xu (' + c.used + '/' + c.max_uses + ')\n';
      bot.sendMessage(msg.chat.id, text);
    }
  });
  commandRegistry.register({
    name: '/ownerstats', description: 'Thống kê', category: 'owner', ownerOnly: true,
    handler: async (msg) => {
      if (!isOwner(msg.from.id)) return bot.sendMessage(msg.chat.id, t(getUserLanguage(msg.from.id), 'owner_only'));
      const users = await db.get('SELECT COUNT(*) as count FROM users');
      const pets = await db.get('SELECT COUNT(*) as count FROM pets');
      const codes = await db.get('SELECT COUNT(*) as count FROM redeem_codes');
      bot.sendMessage(msg.chat.id, '👥 Users: ' + users.count + '\n🐾 Pets: ' + pets.count + '\n🎟️ Codes: ' + codes.count);
    }
  });

  // 1500 static commands
  for (let i = 1; i <= 1500; i++) {
    commandRegistry.register({
      name: '/cmd' + i, description: 'Static command ' + i, category: 'static',
      handler: (msg) => bot.sendMessage(msg.chat.id, 'Static command ' + i),
    });
  }
}

// ======================= BOT SETUP =======================
const bot = new TelegramBot(ENV.TELEGRAM_TOKEN, { polling: true });

// ======================= CALLBACK HANDLER =======================
bot.on('callback_query', async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const lang = getUserLanguage(userId);

  if (data.startsWith('lang:')) {
    const newLang = data.split(':')[1];
    if (LANGUAGES.includes(newLang)) {
      setUserLanguage(userId, newLang);
      bot.answerCallbackQuery(query.id, { text: t(newLang, 'language_set', { lang: newLang }) });
      bot.sendMessage(chatId, t(newLang, 'language_set', { lang: newLang }));
    }
    return;
  }

  if (data === 'help_prev' || data === 'help_next' || data === 'help_home') {
    const all = commandRegistry.getAll(false);
    const pageSize = 10;
    const totalPages = Math.ceil(all.length / pageSize);
    let page = helpPageState.get(userId) || 1;
    if (data === 'help_prev') page = Math.max(1, page - 1);
    if (data === 'help_next') page = Math.min(totalPages, page + 1);
    if (data === 'help_home') page = 1;
    helpPageState.set(userId, page);
    const start = (page - 1) * pageSize;
    const pageCommands = all.slice(start, start + pageSize);
    let text = t(lang, 'help_title', { page, total: totalPages }) + '\n\n';
    pageCommands.forEach(cmd => text += '/' + cmd.name + ' - ' + cmd.description + '\n');
    text += '\n' + t(lang, 'prev') + '  ' + t(lang, 'page') + ' ' + page + '/' + totalPages + '  ' + t(lang, 'next');
    text = addFooter(text, lang);
    const keyboard = [
      [{ text: t(lang, 'prev'), callback_data: 'help_prev' }, { text: t(lang, 'next'), callback_data: 'help_next' }],
      [{ text: t(lang, 'home'), callback_data: 'help_home' }, { text: t(lang, 'search'), callback_data: 'help_search' }],
    ];
    bot.answerCallbackQuery(query.id);
    bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: keyboard } });
    return;
  }

  let responseText = '';
  switch (data) {
    case 'menu_ai': responseText = '🤖 AI commands: /ai, /img'; break;
    case 'menu_game': responseText = '🎮 Games: /games'; break;
    case 'menu_pet': responseText = '🐾 Pet: /pet'; break;
    case 'menu_leaderboard': responseText = '🏆 Leaderboard coming soon'; break;
    case 'menu_profile': responseText = '👤 Profile: /profile'; break;
    case 'menu_language': responseText = '🌐 Use /language'; break;
  }
  if (responseText) {
    bot.answerCallbackQuery(query.id);
    bot.sendMessage(chatId, addFooter(responseText, lang));
  }
});

// ======================= MESSAGE HANDLER =======================
bot.on('message', async (msg) => {
  if (!msg.text || msg.from.is_bot) return;
  const cmdName = msg.text.trim().split(' ')[0].toLowerCase();
  const cmd = commandRegistry.resolve(cmdName);
  if (cmd) {
    try {
      await cmd.handler(msg);
    } catch (e) {
      Logger.error('Command error:', e);
      bot.sendMessage(msg.chat.id, t(getUserLanguage(msg.from.id), 'error'));
    }
  }
});

// ======================= EXPRESS SERVER =======================
const app = express();
app.use(express.json({ limit: '100kb' }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/games', (req, res) => res.json(gameEngine.getGames(parseInt(req.query.page) || 1, 20)));
app.post('/api/play', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const user = token ? await authService.verifyToken(token) : null;
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { gameId, amount, choice } = req.body;
  const result = gameEngine.play(gameId, amount, choice);
  if (result.error) return res.status(400).json(result);
  if (result.playerWins) {
    await db.run('UPDATE users SET points = points + ? WHERE id = ?', [result.payout, user.userId]);
  }
  res.json(result);
});
app.post('/api/auth/register', async (req, res) => {
  try {
    const user = await authService.register(req.body.username, req.body.email, req.body.password);
    res.json(user);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post('/api/auth/login', async (req, res) => {
  try {
    const result = await authService.login(req.body.username, req.body.password);
    res.json(result);
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
});
app.get('/api/auth/me', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const user = token ? await authService.verifyToken(token) : null;
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ user });
});

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Super Bot Mini App</title></head><body style="background:#1e1e2f;color:#fff;text-align:center;padding-top:50px;"><h1>🎮 Super Bot Mini App</h1><p>Chào mừng đến với Mini App</p><div id="app"></div><script>fetch('/api/games').then(r=>r.json()).then(data=>{document.getElementById('app').innerHTML='<ul>'+data.games.map(g=>'<li>'+g.name+'</li>').join('')+'</ul>'});</script></body></html>`);
});

app.listen(ENV.PORT, ENV.HOST, () => Logger.info(`Mini App server running on port ${ENV.PORT}`));

// ======================= STARTUP =======================
async function start() {
  await initDatabase();
  registerCommands();
  Logger.info(`Registered ${commandRegistry.getAll(true).length} commands (including owner).`);
  const shutdown = () => {
    bot.stopPolling();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch(err => {
  Logger.error('Startup failed:', err);
  process.exit(1);
});
