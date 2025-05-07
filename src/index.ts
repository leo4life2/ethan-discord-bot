import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Events,
  ChannelType,
} from "discord.js";
import { handle, generateSpeech } from "./logic.js";
import { REST, Routes } from 'discord.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const TOKEN = process.env.DISCORD_TOKEN!;
const ETHAN_CHANNEL_ID = "1266202723448000650"; // talk-to-ethan

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // needs the MESSAGE CONTENT privileged intent enabled
  ],
});

const rest = new REST({ version: '10' })
  .setToken(TOKEN);

// Define interfaces for better type safety with Discord API responses
interface AttachmentSlot {
  id: string;
  upload_filename: string;
  upload_url: string;
}

interface ChannelAttachmentsResponse {
  attachments: AttachmentSlot[];
}

async function sendVoiceMessage(channelId: string, filePath: string, seconds: number, audioFileName: string, attachmentTitle: string) {
  const buf = await fs.readFile(filePath);           // opus-encoded OGG
  // Explicitly type the response from rest.post
  const { attachments: [slot] } = await rest.post(
    `/channels/${channelId}/attachments`, // Use raw path
    { body: { files: [{ id: '0', filename: audioFileName, file_size: buf.length }] } }
  ) as ChannelAttachmentsResponse;

  await fetch(slot.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/ogg' },
    body: buf,
  });

  const waveform = Buffer.alloc(256, 128).toString('base64'); // Generate default flat waveform

  await rest.post(
    `/channels/${channelId}/messages`, // Use raw path
    { body: {
        flags: 1 << 13,                  // 8192
        attachments: [{
          id: '0',
          filename: audioFileName,
          uploaded_filename: slot.upload_filename,
          duration_secs: seconds,
          waveform: waveform, // Use internally generated flat waveform
          title: `Voice message: ${attachmentTitle}`,   // Keep the title field
        }],
      } }
  );
}

client.once(Events.ClientReady, (c) =>
  console.log(`✨ Logged in as ${c.user.tag}`)
);

client.on(Events.MessageCreate, async (msg) => {
  // Ignore bots
  if (msg.author.bot || !client.user) return;

  // Check if the bot is mentioned or if the message is in the designated channel
  const isMentioned = msg.mentions.users.has(client.user.id);
  const isInEthanChannel = msg.channel.id === ETHAN_CHANNEL_ID;

  // Only proceed if the message is in a GuildText or DM channel
  if (
    msg.channel.type === ChannelType.GuildText ||
    msg.channel.type === ChannelType.DM
  ) {
    // Process if mentioned OR in the specific channel
    if (isMentioned || isInEthanChannel) {
      try {
        // Fetch last 20 messages for context (excluding the current one initially)
        const historyCollection = await msg.channel.messages.fetch({ limit: 20 });
        // Convert collection to array and reverse to get oldest first
        const history = Array.from(historyCollection.values()).reverse(); 

        const response = await handle(msg.content, msg, history, client.user.id);
        
        if (response) {
          // Clean up mention if present in reply (optional)
          const finalReply = response.text.replace(/<@!?\d+>/g, '').trim(); 
          
          if (response.generateSpeech) {
            try {
              const speech = await generateSpeech(finalReply);
              if (speech) {
                // Simplified filename generation
                const audioFileNameWithExt = `voice_message_${Date.now()}.ogg`;

                // Pass the original finalReply as the attachment title
                // Waveform is now generated inside sendVoiceMessage
                await sendVoiceMessage(msg.channel.id, speech.filePath, speech.duration, audioFileNameWithExt, finalReply);
                // Clean up the file after sending
                await fs.unlink(speech.filePath).catch(console.error);
              } else {
                await msg.channel.send(finalReply);
              }
            } catch (err) {
              console.error("Error generating or sending speech:", err);
              throw err;
            }
          } else {
            await msg.channel.send(finalReply);
          }
        }
      } catch (err) {
        console.error("Error fetching history or handling message:", err);
        // Optionally send a simpler error message if fetching history failed
        await msg.channel.send("Beep boop... Error processing that.").catch(console.error);
      }
    }
  }
});
// I KNOW THAT THIS WILL SLOW DOWN THE STARTUP SEQUENCE A BIT but we want it to look fancy :sparkles:
await client.login(token).then((token) => {
 client.user.setPresence({
  game: { name: '.help' },
  status: 'online',
 });
});
