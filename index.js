// index.js (ESM)
// Minimal Discord -> HTTP forwarder

import { Client, GatewayIntentBits, Events } from 'discord.js';

// Use global fetch (Node 18+) or fall back if needed
const fetchFn = globalThis.fetch ?? (await import('node-fetch')).default;

const token = process.env.DISCORD_TOKEN;          // required
const forwardUrl = process.env.FORWARD_URL;       // required
const whitelistEnv = process.env.CHANNEL_WHITELIST || ""; // optional

if (!token || !forwardUrl) {
  console.error("Missing DISCORD_TOKEN or FORWARD_URL env vars");
  process.exit(1);
}

const whitelist = whitelistEnv
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const isAllowed = (channelId) =>
  whitelist.length === 0 || whitelist.includes(channelId);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // make sure Message Content Intent is enabled in the bot settings
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log("bot_ready", c.user.tag);
});

client.on(Events.MessageCreate, async (message) => {
  // ignore own/bot messages
  if (message.author?.bot) return;
  if (!isAllowed(message.channelId)) return;

  const payload = {
    platform: "discord",
    thread_id: message.channelId,
    message_id: message.id,
    content: message.content || "",
    author: {
      id: message.author?.id,
      username: message.author?.username,
      global_name: message.author?.globalName ?? null,
    },
    attachments: [...message.attachments.values()].map((a) => ({
      id: a.id,
      name: a.name,
      url: a.url,
      content_type: a
