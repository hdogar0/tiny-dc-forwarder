// index.js — Tiny Discord → n8n forwarder (thread-scoped !human / !bot)
import express from "express";
import { Client, GatewayIntentBits, Events } from "discord.js";

// ---------- ENV ----------
const DISCORD_TOKEN   = process.env.DISCORD_TOKEN;             // required
const PIPE_URL        = process.env.PIPE_URL;                  // required (n8n webhook to forward messages)
const ASSIGN_URL      = process.env.ASSIGN_URL || "";          // optional (n8n webhook to flip HUMAN/BOT for this thread)
const LISTEN_CHANNELS = (process.env.LISTEN_CHANNEL_ID || "")  // supports comma-separated parent channel ids
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

console.log("ENV check:", {
  hasToken: !!DISCORD_TOKEN,
  hasPipe: !!PIPE_URL,
  listen: LISTEN_CHANNELS.length ? LISTEN_CHANNELS : "(all)",
});

if (!DISCORD_TOKEN || !PIPE_URL) {
  console.error("❌ Missing DISCORD_TOKEN or PIPE_URL env vars.");
  process.exit(1);
}

// ---------- helpers ----------
const getBaseChannelId = (channel) => channel?.isThread?.() ? (channel.parentId || channel.id) : channel?.id;
const isAllowedChannel = (message) => {
  if (!LISTEN_CHANNELS.length) return true; // allow all if not set
  const baseId = getBaseChannelId(message.channel);
  return LISTEN_CHANNELS.includes(baseId) || LISTEN_CHANNELS.includes(message.channel.id);
};

// ---------- discord client ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // ensure Message Content Intent is ON in the Dev Portal
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ bot_ready ${c.user.tag}`);
  console.log(
    `ℹ️  Listening on: ${
      LISTEN_CHANNELS.length ? LISTEN_CHANNELS.join(",") : "(all channels I can read)"
    }`
  );
});

client.on(Events.MessageCreate, async (msg) => {
  try {
    // ignore bots/webhooks/system
    if (msg.author?.bot) return;
    if (!isAllowedChannel(msg)) return;

    const channel     = msg.channel;
    const isThread    = channel?.isThread?.() === true;
    const baseId      = getBaseChannelId(channel);     // parent inbox channel id
    const threadId    = isThread ? channel.id : null;  // specific conversation thread id (or null if not in a thread)
    const authorName  = msg.author?.globalName ?? msg.author?.username ?? "Unknown";
    const text        = (msg.content || "").trim();
    const lower       = text.toLowerCase();

    // ---- Commands: !human / !bot -> only allowed inside a thread ----
    if (lower === "!human" || lower === "!bot") {
      if (!ASSIGN_URL) {
        try { await msg.reply("⚠️ assignment webhook not configured."); } catch {}
        return;
      }
      if (!isThread) {
        // guard: do not toggle the whole channel
        try { await msg.reply("ℹ️ Please run `!human` / `!bot` **inside the conversation thread**."); } catch {}
        return;
      }

      const action = lower.slice(1); // 'human' or 'bot'
      try {
        const r = await fetch(ASSIGN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,                // 'human' | 'bot'
            channel_id: baseId,    // parent inbox channel
            thread_id: threadId,   // this specific thread
            actor: authorName,
          }),
        });
        console.log(`🔧 assign ${action} → ${r.status}`);
        try {
          await msg.reply(r.ok ? `✅ set to **${action}** for this thread` : `⚠️ assign failed (${r.status})`);
        } catch {}
      } catch (e) {
        console.error("assign_error", e?.message || e);
        try { await msg.reply("⚠️ assign error"); } catch {}
      }
      return; // do not forward the command
    }

    // ---- Build attachments (urls only; expand later if needed) ----
    const attachments = [...msg.attachments.values()].map(a => ({
      id: a.id,
      name: a.name,
      url: a.url,
      content_type: a.contentType ?? null,
      size: a.size,
    }));

    // ---- Forward to n8n (PIPE_URL) ----
    const payload = {
      platform: "discord",
      guild_id: msg.guild?.id ?? null,
      channel_id: baseId,        // parent inbox
      thread_id: threadId,       // specific conversation (null if not in a thread)
      message_id: msg.id,
      content: text,
      author: {
        id: msg.author?.id,
        username: msg.author?.username,
        global_name: msg.author?.globalName ?? null,
      },
      attachments,
      ts: msg.createdAt.toISOString(),
    };

    const res = await fetch(PIPE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    console.log(`➡️  forwarded → ${res.status} (thread: ${threadId || "none"}, parent: ${baseId})`);
  } catch (e) {
    console.error("message_handler_error", e?.message || e);
  }
});

// login
client.login(DISCORD_TOKEN);

// ---------- tiny health server ----------
const app = express();
app.get("/", (_req, res) => res.send("ok"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 health on :${PORT}`));
