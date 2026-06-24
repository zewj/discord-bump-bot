const { Client } = require('discord.js-selfbot-v13');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const client = new Client({
  checkUpdate: false,
});

// ---------------------------------------------------------------------------
// Config-driven multi-bot definitions
// ---------------------------------------------------------------------------
// Each bot runs its OWN independent scheduling loop, with its OWN channel and
// cooldown. Patterns are lowercase substrings matched case-insensitively
// against the bot's reply (embed title/description/content). Empty patterns are
// tolerated gracefully. The 2h DISBOARD base cooldown is preserved below.
const BUMP_BOTS = [
  {
    key: 'disboard',
    name: 'DISBOARD',
    botId: '302050872383242240',
    command: 'bump',
    cooldownMs: 2 * 60 * 60 * 1000, // 2 hours (confirmed)
    successPattern: 'bump done',
    cooldownPattern: 'please wait',
    defaultEnabled: true,
  },
  {
    key: 'discadia',
    name: 'Discadia',
    botId: '1222548162741538938',
    command: 'bump',
    cooldownMs: 6 * 60 * 60 * 1000, // 6 hours (medium confidence)
    successPattern: '', // not verified
    cooldownPattern: '', // not verified
    // TODO: verify botId before enabling (cooldown + reply wording unverified)
    defaultEnabled: false,
  },
  {
    key: 'disforge',
    name: 'Disforge',
    botId: '', // TODO: verify botId before enabling (no verified bump bot)
    command: 'bump',
    cooldownMs: 6 * 60 * 60 * 1000,
    successPattern: '',
    cooldownPattern: '',
    defaultEnabled: false,
  },
  {
    key: 'discordscom',
    name: 'Discords.com',
    botId: '', // TODO: verify botId before enabling (website bump, no known bot)
    command: 'bump',
    cooldownMs: 6 * 60 * 60 * 1000,
    successPattern: '',
    cooldownPattern: '',
    defaultEnabled: false,
  },
  {
    key: 'dsme',
    name: 'DSME / Discord Server Manager',
    botId: '', // TODO: verify botId before enabling (no known /bump slash command)
    command: 'bump',
    cooldownMs: 6 * 60 * 60 * 1000,
    successPattern: '',
    cooldownPattern: '',
    defaultEnabled: false,
  },
];

const botByKey = Object.fromEntries(BUMP_BOTS.map(b => [b.key, b]));
const validKeys = BUMP_BOTS.map(b => b.key);

// Your images (configurable per outcome, preserved from the original)
const images = {
  success: 'https://i.imgur.com/FgO6Znz.jpeg',
  cooldown: 'https://i.imgur.com/j498rDA.jpeg',
  error: 'https://i.imgur.com/j498rDA.jpeg',
  invalid: 'https://i.imgur.com/j498rDA.jpeg',
  test: 'https://i.imgur.com/j498rDA.jpeg',
};

const COLORS = {
  success: 0x00ff00,
  cooldown: 0xffa500,
  error: 0xff0000,
};

// ---------------------------------------------------------------------------
// Runtime settings
// ---------------------------------------------------------------------------
// Shape: { webhookUrl, bots: { <key>: { channelId, enabled } } }
const settingsFile = path.join(__dirname, 'settings.json');

let webhookUrl = process.env.WEBHOOK_URL || '';
// Per-bot runtime state. channelId/enabled are persisted; the rest is live.
const state = Object.fromEntries(
  BUMP_BOTS.map(b => [b.key, {
    channelId: b.key === 'disboard' ? (process.env.BUMP_CHANNEL || '') : '',
    enabled: b.defaultEnabled,
    timer: null,
    nextBumpAt: null,
  }])
);

const isValidWebhookUrl = (url) =>
  typeof url === 'string' && url.startsWith('https://discord.com/api/webhooks/');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Channels that can validly host a bump (text, news/announcement, threads).
function isBumpableChannel(channel) {
  if (!channel || !channel.guild) return false;
  if (typeof channel.isText === 'function') return channel.isText();
  return ['GUILD_TEXT', 'GUILD_NEWS', 'GUILD_ANNOUNCEMENT'].includes(channel.type);
}

// ---------------------------------------------------------------------------
// Settings load/save (atomic write + serialized via a promise queue)
// ---------------------------------------------------------------------------
function buildSettings() {
  const bots = {};
  for (const b of BUMP_BOTS) {
    bots[b.key] = {
      channelId: state[b.key].channelId || '',
      enabled: !!state[b.key].enabled,
    };
  }
  return { webhookUrl, bots };
}

let saveChain = Promise.resolve();
function saveSettings() {
  saveChain = saveChain.then(async () => {
    try {
      const data = JSON.stringify(buildSettings(), null, 2);
      const tmp = settingsFile + '.tmp';
      await fs.writeFile(tmp, data);
      await fs.rename(tmp, settingsFile); // atomic on the same volume
      console.log('Saved settings to settings.json');
    } catch (error) {
      console.error('Error saving settings:', error.message);
    }
  }).catch(err => console.error('Error in save queue:', err));
  return saveChain;
}

async function loadSettings() {
  let data;
  try {
    data = await fs.readFile(settingsFile, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      // Treat settings.json purely as runtime override storage: if it's absent,
      // just proceed with env values WITHOUT creating a file.
      console.log('No settings.json found; using environment values.');
      logConfigSource();
      return;
    }
    console.error('Error loading settings:', error.message);
    return;
  }

  let settings;
  try {
    settings = JSON.parse(data);
  } catch (error) {
    // Corrupt JSON: back up the bad file instead of crashing.
    console.error('settings.json is corrupt:', error.message);
    try {
      await fs.rename(settingsFile, settingsFile + '.corrupt-' + Date.now());
      console.warn('Backed up corrupt settings.json; using environment values.');
    } catch (e) {
      console.error('Could not back up corrupt settings.json:', e.message);
    }
    logConfigSource();
    return;
  }

  // --- Migrate the OLD shape { selfbot: { bumpChannelId, webhookUrl } } ---
  if (settings.selfbot && !settings.bots) {
    if (settings.selfbot.bumpChannelId) {
      state.disboard.channelId = settings.selfbot.bumpChannelId;
    }
    if (settings.selfbot.webhookUrl) {
      webhookUrl = settings.selfbot.webhookUrl;
    }
    console.log('Migrated old settings.json shape to the new multi-bot shape.');
    await saveSettings();
    logConfigSource();
    return;
  }

  // --- New shape ---
  if (typeof settings.webhookUrl === 'string' && settings.webhookUrl) {
    webhookUrl = settings.webhookUrl;
  }
  if (settings.bots && typeof settings.bots === 'object') {
    for (const key of validKeys) {
      const s = settings.bots[key];
      if (!s) continue;
      if (typeof s.channelId === 'string' && s.channelId) state[key].channelId = s.channelId;
      if (typeof s.enabled === 'boolean') state[key].enabled = s.enabled;
    }
  }
  console.log('Loaded bump settings from settings.json');
  logConfigSource();
}

function logConfigSource() {
  console.log(`Config -> webhook: ${isValidWebhookUrl(webhookUrl) ? 'set' : 'unset'}`);
  for (const b of BUMP_BOTS) {
    const s = state[b.key];
    console.log(`  ${b.key.padEnd(12)} channel=${s.channelId || '(none)'} enabled=${s.enabled}`);
  }
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------
const sendWebhook = async (payload) => {
  if (!isValidWebhookUrl(webhookUrl)) {
    console.log('Webhook not sent: Invalid or unset webhook URL.');
    return;
  }
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      console.log('Webhook notification sent successfully.');
    } else {
      console.error(`Webhook failed with status ${response.status}`);
    }
  } catch (error) {
    console.error('Error sending webhook:', error.message);
  }
};

function notify({ title, description, color, image }) {
  return sendWebhook({
    embeds: [{
      title,
      description,
      color,
      image: { url: image },
      timestamp: new Date().toISOString(),
    }],
  });
}

// ---------------------------------------------------------------------------
// Scheduling helpers
// ---------------------------------------------------------------------------
function jitter() {
  return (Math.floor(Math.random() * 3) + 1) * 60000; // 1-3 min
}

// Pull a flat blob of text out of the bot's reply for pattern matching.
function replyText(message) {
  let text = message.content || '';
  for (const embed of message.embeds || []) {
    if (embed.title) text += '\n' + embed.title;
    if (embed.description) text += '\n' + embed.description;
  }
  return text.toLowerCase();
}

// Parse "please wait another 42 minutes" -> 42 (minutes).
function parseRemainingMinutes(text) {
  const m = text.match(/(\d+)\s*(?:minute|min|m\b)/i);
  if (m) return parseInt(m[1], 10);
  const h = text.match(/(\d+)\s*(?:hour|hr|h\b)/i);
  if (h) return parseInt(h[1], 10) * 60;
  return null;
}

function scheduleNext(bot, ms, reason) {
  const s = state[bot.key];
  if (s.timer) {
    clearTimeout(s.timer);
    s.timer = null;
  }
  if (!s.enabled) {
    s.nextBumpAt = null;
    return;
  }
  s.nextBumpAt = Date.now() + ms;
  s.timer = setTimeout(() => attemptBump(bot), ms);
  console.log(`[${bot.key}] next bump in ${Math.round(ms / 60000)} min (${reason})`);
}

// ---------------------------------------------------------------------------
// Core bump attempt (response-aware)
// ---------------------------------------------------------------------------
async function attemptBump(bot) {
  const s = state[bot.key];
  if (!s.enabled) return;

  try {
    if (!bot.botId) {
      console.log(`[${bot.key}] no botId configured; skipping.`);
      await notify({
        title: `${bot.name}: Not Configured`,
        description: 'No bot ID configured for this bump bot.',
        color: COLORS.cooldown,
        image: images.invalid,
      });
      scheduleNext(bot, bot.cooldownMs, 'no botId');
      return;
    }

    const channel = client.channels.cache.get(s.channelId);
    if (!isBumpableChannel(channel)) {
      console.log(`[${bot.key}] channel ${s.channelId} not found or not bumpable!`);
      await notify({
        title: `${bot.name}: Invalid Channel`,
        description: 'The specified channel is not found or not a text channel.',
        color: COLORS.cooldown,
        image: images.invalid,
      });
      scheduleNext(bot, bot.cooldownMs, 'invalid channel');
      return;
    }

    // The return value of sendSlash IS the bot's reply to our interaction —
    // including EPHEMERAL responses like DISBOARD's "Please wait another N
    // minutes until the server can be bumped" cooldown notice. Ephemeral
    // messages reach only the invoking account as a nonce-matched
    // MESSAGE_CREATE, so channel.awaitMessages() (public messages only) can
    // never see them. That is why cooldown replies went undetected before.
    let reply = null;
    try {
      reply = await channel.sendSlash(bot.botId, bot.command);
    } catch (err) {
      // sendSlash rejects (INTERACTION_FAILED) if nothing arrives within ~5s.
      console.warn(`[${bot.key}] no interaction reply: ${err.message}`);
    }
    console.log(`[${bot.key}] sent /${bot.command} in channel ${s.channelId}`);

    const hasText = m => Boolean(m && (m.content || (m.embeds && m.embeds.length)));

    // Fallback for a non-ephemeral or deferred public reply the interaction
    // promise may have missed: briefly watch for a public message from the bot.
    if (!hasText(reply)) {
      try {
        const collected = await channel.awaitMessages({
          filter: m => m.author.id === bot.botId && hasText(m),
          max: 1,
          time: 8000,
        });
        reply = collected.first() || reply;
      } catch (_) {
        /* keep reply as-is (likely null) */
      }
    }

    if (!hasText(reply)) {
      // No reply: don't let the loop die. Reschedule on full cooldown.
      console.warn(`[${bot.key}] no reply from bot within timeout.`);
      await notify({
        title: `${bot.name}: No Response`,
        description: `Sent /${bot.command} in <#${s.channelId}> but got no reply. Will retry next cooldown.`,
        color: COLORS.cooldown,
        image: images.cooldown,
      });
      scheduleNext(bot, bot.cooldownMs, 'no reply');
      return;
    }

    const text = replyText(reply);
    const cooldownHit = bot.cooldownPattern && text.includes(bot.cooldownPattern);
    const successHit = bot.successPattern && text.includes(bot.successPattern);

    if (cooldownHit) {
      const remainingMin = parseRemainingMinutes(text);
      const ms = remainingMin != null ? remainingMin * 60000 + jitter() : bot.cooldownMs;
      console.log(`[${bot.key}] on cooldown (${remainingMin != null ? remainingMin + ' min left' : 'unknown'}).`);
      await notify({
        title: `${bot.name}: On Cooldown`,
        description: remainingMin != null
          ? `Already bumped. ~${remainingMin} min remaining in <#${s.channelId}>.`
          : `Already bumped in <#${s.channelId}>.`,
        color: COLORS.cooldown,
        image: images.cooldown,
      });
      scheduleNext(bot, ms, 'reported cooldown');
      return;
    }

    // Success: explicit success pattern, OR no known patterns and no error.
    const treatAsSuccess = successHit || (!bot.successPattern && !bot.cooldownPattern);
    if (treatAsSuccess) {
      console.log(`[${bot.key}] bump successful.`);
      await notify({
        title: `${bot.name}: Bump Successful`,
        description: `Successfully bumped in <#${s.channelId}>.`,
        color: COLORS.success,
        image: images.success,
      });
      scheduleNext(bot, bot.cooldownMs + jitter(), 'success');
      return;
    }

    // Reply arrived but matched nothing we recognize.
    console.warn(`[${bot.key}] unrecognized reply; rescheduling on full cooldown.`);
    await notify({
      title: `${bot.name}: Unknown Response`,
      description: `Got a reply in <#${s.channelId}> that did not match success or cooldown.`,
      color: COLORS.cooldown,
      image: images.cooldown,
    });
    scheduleNext(bot, bot.cooldownMs, 'unknown reply');
  } catch (error) {
    // Any thrown error reschedules instead of killing the loop.
    console.error(`[${bot.key}] error sending bump:`, error);
    await notify({
      title: `${bot.name}: Bump Error`,
      description: 'An error occurred while sending the bump command.',
      color: COLORS.error,
      image: images.error,
    });
    scheduleNext(bot, bot.cooldownMs + jitter(), 'error');
  }
}

// Start a bot's loop (fires soon, then self-schedules). Idempotent.
function startBot(bot, initialDelay = 5000) {
  const s = state[bot.key];
  if (!s.enabled) return;
  if (s.timer) clearTimeout(s.timer);
  s.nextBumpAt = Date.now() + initialDelay;
  s.timer = setTimeout(() => attemptBump(bot), initialDelay);
  console.log(`[${bot.key}] loop started (first attempt in ${Math.round(initialDelay / 1000)}s).`);
}

function stopBot(bot) {
  const s = state[bot.key];
  if (s.timer) {
    clearTimeout(s.timer);
    s.timer = null;
  }
  s.nextBumpAt = null;
  console.log(`[${bot.key}] loop stopped.`);
}

function startAllEnabled() {
  for (const bot of BUMP_BOTS) {
    if (state[bot.key].enabled) startBot(bot);
  }
}

// ---------------------------------------------------------------------------
// Client lifecycle (one-time setup, resilient)
// ---------------------------------------------------------------------------
let setupDone = false;

client.once('ready', async () => {
  await loadSettings();
  console.log(`${client.user.username} is ready!`);
  if (!setupDone) {
    setupDone = true;
    startAllEnabled();
  }
});

// Re-emitted 'ready' (after a resume/reconnect): re-arm loops only if cleared.
client.on('ready', () => {
  if (!setupDone) return;
  for (const bot of BUMP_BOTS) {
    const s = state[bot.key];
    if (s.enabled && !s.timer) startBot(bot);
  }
});

client.on('error', e => console.error('Client error:', e));
client.on('warn', w => { if (process.env.DEBUG) console.warn('Client warn:', w); });
client.on('shardDisconnect', (ev, id) => console.warn('Shard', id, 'disconnected', ev?.code));
client.on('shardReconnecting', id => console.log('Reconnecting shard', id));
client.on('shardResume', id => console.log('Shard', id, 'resumed'));

process.on('unhandledRejection', r => console.error('unhandledRejection:', r));
process.on('uncaughtException', e => console.error('uncaughtException:', e));

// ---------------------------------------------------------------------------
// Commands (self-messages only)
// ---------------------------------------------------------------------------
function resolveChannelId(arg) {
  if (!arg) return null;
  return arg.replace(/[<#>]/g, '');
}

function keyListReply() {
  return `Valid bot keys: ${validKeys.join(', ')}`;
}

client.on('messageCreate', async (message) => {
  if (message.author.id !== client.user.id) return;

  const args = message.content.trim().split(/\s+/);
  const cmd = args[0];

  // ----- !bumpstatus -----
  if (cmd === '!bumpstatus') {
    const lines = BUMP_BOTS.map(b => {
      const s = state[b.key];
      const ch = s.channelId ? `<#${s.channelId}>` : '(unset)';
      let next = '-';
      if (s.enabled && s.nextBumpAt) {
        const mins = Math.max(0, Math.round((s.nextBumpAt - Date.now()) / 60000));
        next = `~${mins} min`;
      }
      return `**${b.name}** (\`${b.key}\`) — ${s.enabled ? 'enabled' : 'disabled'} — channel ${ch} — next ${next}`;
    });
    return message.channel.send(lines.join('\n'));
  }

  // ----- !setchannel <key> [#channel|id] -----
  if (cmd === '!setchannel') {
    const key = args[1];
    if (!key || !botByKey[key]) {
      return message.channel.send(`Invalid key. ${keyListReply()}`);
    }
    const channelId = resolveChannelId(args[2]) || message.channel.id;
    const channel = client.channels.cache.get(channelId);
    if (!isBumpableChannel(channel)) {
      return message.channel.send('Please provide a valid text channel.');
    }
    state[key].channelId = channelId;
    await saveSettings();
    return message.channel.send(`${botByKey[key].name} channel set to <#${channelId}>.`);
  }

  // ----- !setbumpchannel [#channel|id]  (backward-compatible DISBOARD alias) -----
  if (cmd === '!setbumpchannel') {
    const channelId = resolveChannelId(args[1]) || message.channel.id;
    const channel = client.channels.cache.get(channelId);
    if (!isBumpableChannel(channel)) {
      return message.channel.send('Please provide a valid text channel.');
    }
    state.disboard.channelId = channelId;
    await saveSettings();
    return message.channel.send(`Bump channel set to <#${channelId}>.`);
  }

  // ----- !setwebhook <url> -----
  if (cmd === '!setwebhook') {
    const url = args[1];
    if (!isValidWebhookUrl(url)) {
      return message.channel.send('Please provide a valid Discord webhook URL (https://discord.com/api/webhooks/...).');
    }
    webhookUrl = url;
    await saveSettings();
    return message.channel.send('Webhook URL set successfully.');
  }

  // ----- !enable <key> -----
  if (cmd === '!enable') {
    const key = args[1];
    if (!key || !botByKey[key]) {
      return message.channel.send(`Invalid key. ${keyListReply()}`);
    }
    const bot = botByKey[key];
    if (!bot.botId) {
      return message.channel.send(`Cannot enable \`${key}\`: no botId configured. Verify and set it in BUMP_BOTS first.`);
    }
    if (!state[key].channelId) {
      return message.channel.send(`Set a channel first: \`!setchannel ${key}\`.`);
    }
    state[key].enabled = true;
    await saveSettings();
    startBot(bot);
    return message.channel.send(`${bot.name} enabled. Bumping in <#${state[key].channelId}>.`);
  }

  // ----- !disable <key> -----
  if (cmd === '!disable') {
    const key = args[1];
    if (!key || !botByKey[key]) {
      return message.channel.send(`Invalid key. ${keyListReply()}`);
    }
    state[key].enabled = false;
    await saveSettings();
    stopBot(botByKey[key]);
    return message.channel.send(`${botByKey[key].name} disabled.`);
  }

  // ----- !bumpnow <key> -----
  if (cmd === '!bumpnow') {
    const key = args[1];
    if (!key || !botByKey[key]) {
      return message.channel.send(`Invalid key. ${keyListReply()}`);
    }
    const bot = botByKey[key];
    if (!state[key].channelId) {
      return message.channel.send(`Set a channel first: \`!setchannel ${key}\`.`);
    }
    await message.channel.send(`Triggering an immediate bump for ${bot.name}...`);
    // Force a one-off attempt regardless of enabled state.
    const wasEnabled = state[key].enabled;
    state[key].enabled = true;
    await attemptBump(bot);
    if (!wasEnabled) {
      state[key].enabled = false;
      stopBot(bot);
    }
    return;
  }
});

// ---------------------------------------------------------------------------
// Startup + login (with env guards and backoff re-login)
// ---------------------------------------------------------------------------
if (!process.env.DISCORD_TOKEN) {
  console.error('FATAL: DISCORD_TOKEN is not set. Create a .env file with DISCORD_TOKEN=...');
  process.exit(1);
}
if (!process.env.BUMP_CHANNEL) {
  console.warn('Note: BUMP_CHANNEL is not set. Set the DISBOARD channel with !setbumpchannel or via settings.json.');
}
if (!process.env.WEBHOOK_URL) {
  console.warn('Note: WEBHOOK_URL is not set. Webhook notifications are disabled until you set one.');
}

let loginAttempts = 0;
async function loginWithBackoff() {
  try {
    await client.login(process.env.DISCORD_TOKEN);
    loginAttempts = 0;
  } catch (error) {
    loginAttempts++;
    const wait = Math.min(60000, 5000 * loginAttempts);
    console.error(`Login failed (attempt ${loginAttempts}): ${error.message}. Retrying in ${Math.round(wait / 1000)}s...`);
    await delay(wait);
    return loginWithBackoff();
  }
}

loginWithBackoff();