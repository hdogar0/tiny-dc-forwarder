// index.js
import { Client, GatewayIntentBits, Partials } from "discord.js";
import express from "express";
import fetch from "node-fetch";

// ---- Env ----
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const FORWARD_URL  = process.env.FORWARD_URL;      // your n8n webhook
const CHANNELS     = (process.env.CHANNELS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);                                  // comma-separated channel IDs

if (!DISCORD_TOKEN) {
  console.error("Missing DISCORD_TOKEN");
  process.exit(1);
}

// ---- Discord client ----
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User],
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// allow parent channel match for threads
function isAllowed(message) {
  if (CHANNELS.length === 0) return true;
  const ch = message.channel;
  const parentId = typeof ch.isThread === "function" && ch.isThread() ? ch.parentId : null;
  const testIds = [ch.id, parentId].filter(Boolean);
  return testIds.some(id => CHANNELS.includes(id));
}

client.on("messageCreate", async (message) => {
  try {
    if (message.author?.bot) return;
    if (!isAllowed(message)) return;

    const ch = message.channel;
    const isThread = typeof ch.isThread === "function" && ch.isThread();

    const payload = {
      platform: "discord",
      guild_id: message.guild?.id ?? null,
      channel_id: isThread ? ch.parentId : ch.id, // parent channel if in a thread
      thread_id: ch.id,                            // thread or channel id
      message_id: message.id,
      content: message.content || "",
      author: {
        id: message.author.id,
        username: message.author.username,
        global_name: message.author.globalName ?? null,
      },
      attachments: [...message.attachments.values()].map(a => ({
        id: a.id,
        name: a.name,
        url: a.url,
        content_type: a.contentType ?? null,
        size: a.size,
      })),
      ts: message.createdAt.toISOString(),
    };

    if (FORWARD_URL) {
      const res = await fetch(FORWARD_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        console.error("Forward failed:", res.status, t.slice(0, 200));
      }
    } else {
      console.log("FORWARD_URL not set; payload:", payload);
    }
  } catch (err) {
    console.error("messageCreate error:", err);
  }
});

client.login(DISCORD_TOKEN);

// tiny health server (for Render/Railway uptime)
const app = express();
app.get("/", (_req, res) => res.send("ok"));
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🌐 Health server on :${PORT}`));
