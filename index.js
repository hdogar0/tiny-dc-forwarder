// index.js
import express from "express";
import { Client, GatewayIntentBits, Events } from "discord.js";

// --- envs ---
const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.LISTEN_CHANNEL_ID;  // the Discord text channel ID
const PIPE_URL = process.env.PIPE_URL;             // your n8n webhook URL

console.log("ENV check:", {
  hasToken: !!TOKEN,
  hasChannel: !!CHANNEL_ID,
  hasPipe: !!PIPE_URL,
});

if (!TOKEN || !CHANNEL_ID || !PIPE_URL) {
  console.error("Missing env vars. Set DISCORD_TOKEN, LISTEN_CHANNEL_ID, PIPE_URL.");
  process.exit(1);
}

// --- discord client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, () => {
  console.log("Discord bot ready. Listening on channel:", CHANNEL_ID);
});

client.on(Events.MessageCreate, async (msg) => {
  try {
    if (msg.channelId !== CHANNEL_ID) return;

    const payload = {
      platform: "discord",
      thread_id: msg.channelId,
      message_id: msg.id,
      content: msg.content || "",
      author: {
        id: msg.author.id,
        username: msg.author.username,
        global_name: msg.author.globalName ?? null,
      },
      attachments:
        msg.attachments?.map?.((a) => ({
          url: a.url,
          contentType: a.contentType || null,
        })) ?? [],
    };

    const r = await fetch(PIPE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    console.log("Forwarded to n8n →", r.status);
  } catch (e) {
    console.error("Forward error:", e);
  }
});

client.login(TOKEN);

// tiny server to keep the process alive
const app = express();
app.get("/", (_, res) => res.send("ok"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Tiny server up on", PORT));
