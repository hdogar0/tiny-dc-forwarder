// index.js — Tiny Discord → n8n forwarder (thread-scoped !human / !bot)
import express from "express";
import { Client, GatewayIntentBits, Events, ChannelType } from "discord.js";

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
  hasAssign: !!ASSIGN_URL,
  listen: LISTEN_CHANNELS.length ? LISTEN_CHANNELS : "(all)",
});

if (!DISCORD_TOKEN || !PIPE_URL) {
  console.error("❌ Missing DISCORD_TOKEN or PIPE_URL env vars.");
  process.exit(1);
}

// ---------- helpers ----------
const isThread = (channel) => {
  if (!channel) return false;
  if (typeof channel.isThread === "function") return channel.isThread();
  return (
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread ||
    channel.type === ChannelType.AnnouncementThread
  );
};
const getBaseChannelId = (channel) => (isThread(channel) ? (channel.parentId || channel.id) : channel?.id);
const getIds = (channel) => {
  const base = getBaseChannelId(channel);
  return {
    channel_id: base,                    // parent inbox channel
    thread_id: isThread(channel) ? channel.id : null, // specific conversation thread (null if not a thread)
  };
};
const isAllowedChannel = (message) => {
  if (!LISTEN_CHANNELS.length) return true; // allow all if not set
  const baseId = getBaseChannelId(message.channel);
  return LISTEN_CHANNELS.includes(baseId) || LISTEN_CHANNELS.includes(message.channel.id);
};

async function callAssign(mode, message) {
  if (!ASSIGN_URL) return false;
  const { channel_id, thread_id } = getIds(message.channel);
  const payload = {
    action: mode, // "human" | "bot"
    channel_id,
    thread_id,
    author_id: message.author?.id,
    author_name: message.author?.username,
    content: message.content ?? "",
  };

  try {
    const res = await fetch(ASSIGN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text().catch(() => "");
    console.log("ASSIGN >", res.status, text || "(no body)");
    return res.ok;
  } catch (e) {
    console.error("ASSIGN failed:", e?.message || e);
    return false;
  }
}

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
    `ℹ️  Listening on: ${LISTEN_CHANNELS.length ? LISTEN_CHANNELS.join(",") : "(all channels I can read)"}`
  );
});

client.on(Events.MessageCreate, async (msg) => {
  try {
    // ignore bots/webhooks/system
    if (msg.author?.bot) return;
    if (!isAllowedChannel(msg)) return;

    const text  = (msg.content || "").trim();
    const lower = text.toLowerCase();

    // ---- Commands: !human / !bot -> only allowed inside a thread ----
    if (lower === "!human" || lower === "!bot") {
      if (!ASSIGN_URL) {
        try { await msg.reply("⚠️ assignment webhook not configured."); } catch {}
        return;
      }
      if (!isThread(msg.channel)) {
        try { await msg.reply("ℹ️ Please run `!human` / `!bot` **inside the conversation thread**."); } catch {}
        return;
      }

      const mode = lower.slice(1); // 'human' or 'bot'
      const ok = await callAssign(mode, msg);
      try {
        await msg.reply(ok ? `✅ set to **${mode}** for this thread` : `⚠️ failed to set ${mode} (check ASSIGN_URL / logs)`);
      } catch {}
      return; // do not forward the command to PIPE_URL
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
    const { channel_id, thread_id } = getIds(msg.channel);
    const payload = {
      platform: "discord",
      guild_id: msg.guild?.id ?? null,
      channel_id,                 // parent inbox
      thread_id,                  // specific conversation (null if not in a thread)
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

    console.log(`➡️  forwarded → ${res.status} (thread: ${thread_id || "none"}, parent: ${channel_id})`);
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

// keep process alive and noisy on unhandled errors
process.on("unhandledRejection", (r) => console.error("UNHANDLED_REJECTION", r));
process.on("uncaughtException", (e) => console.error("UNCAUGHT_EXCEPTION", e));
