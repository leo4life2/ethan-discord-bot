import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Events,
  ChannelType,
} from "discord.js";
import { handle } from "./logic.js";

const TOKEN = process.env.DISCORD_TOKEN!;
const ETHAN_CHANNEL_ID = "1266202723448000650"; // talk-to-ethan

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // needs the MESSAGE CONTENT privileged intent enabled
  ],
});

client.once(Events.ClientReady, (c) =>
  console.log(`✨ Logged in as ${c.user.tag}`)
);

client.on(Events.MessageCreate, async (msg) => {
  // Ignore bots
  if (msg.author.bot) return;

  // Check if the bot is mentioned or if the message is in the designated channel
  const isMentioned = msg.mentions.users.has(client.user!.id);
  const isInEthanChannel = msg.channel.id === ETHAN_CHANNEL_ID;

  // Only proceed if the message is in a GuildText or DM channel
  if (
    msg.channel.type === ChannelType.GuildText ||
    msg.channel.type === ChannelType.DM
  ) {
    // Process if mentioned OR in the specific channel
    if (isMentioned || isInEthanChannel) {
      try {
        const reply = await handle(msg.content, msg);
        // Clean up mention if present in reply (optional)
        const finalReply = reply?.replace(/<@!?\d+>/g, '').trim(); 
        if (finalReply) await msg.channel.send(finalReply);
      } catch (err) {
        console.error("handler error:", err);
      }
    }
  }
});

await client.login(TOKEN);
