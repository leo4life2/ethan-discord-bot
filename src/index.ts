import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Events,
  ChannelType,
  MessageFlags,
  Routes,
} from "discord.js";
import { handle, generateSpeech } from "./logic.js";
import { REST } from "@discordjs/rest";
import fs from 'node:fs/promises';
import { startPresenceRotation } from './presence.js';
import * as PromptView from './commands/prompt-view.js';
import * as PromptEdit from './commands/prompt-edit.js';
import * as PromptHistory from './commands/prompt-history.js';
import * as PromptRollback from './commands/prompt-rollback.js';

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
  const buf = await fs.readFile(filePath); // buf is a Node.js Buffer
  const { attachments: [slot] } = await rest.post(
    `/channels/${channelId}/attachments`,
    { body: { files: [{ id: '0', filename: audioFileName, file_size: buf.length }] } }
  ) as ChannelAttachmentsResponse;

  await fetch(slot.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/ogg' },
    // Cast to any to satisfy BodyInit; node's undici accepts Buffer
    body: buf as any,
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

async function registerSlashCommands(readyClient: any) {
  try {
    // Ensure application data is loaded
    if (!readyClient.application) {
      await readyClient.fetchApplication?.();
    } else {
      await readyClient.application.fetch?.();
    }
    const CLIENT_ID = readyClient.application?.id;
    const GUILD_ID = process.env.DISCORD_GUILD_ID || '1261542082124972193';
    if (!CLIENT_ID) {
      console.warn('Unable to resolve application id; skipping command registration');
      return;
    }
    const commandBodies = [
      (PromptView as any).data.toJSON(),
      (PromptEdit as any).data.toJSON(),
      (PromptHistory as any).data.toJSON(),
      (PromptRollback as any).data.toJSON(),
    ];
    // Always register to the target guild for immediate availability
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commandBodies });
    console.log(`✅ Registered guild commands in ${GUILD_ID}`);
  } catch (e) {
    console.error('Failed to register slash commands:', e);
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✨ Logged in as ${readyClient.user.tag}`);
  if (readyClient.user) { // Ensure client.user is available
    startPresenceRotation(readyClient); // Start new presence rotation
  }
  await registerSlashCommands(readyClient);
});

// Register interaction handler for slash commands
const commands = new Map<string, { execute: (interaction: any) => Promise<any> }>([
  ['prompt-view', { execute: PromptView.execute }],
  ['prompt-edit', { execute: PromptEdit.execute }],
  ['show-edit-history', { execute: PromptHistory.execute }],
  ['prompt-rollback', { execute: PromptRollback.execute }],
]);

client.on(Events.InteractionCreate, async (interaction: any) => {
  try {
    if (!interaction.isChatInputCommand()) return;
    const handler = commands.get(interaction.commandName);
    if (!handler) {
      return interaction.reply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral });
    }
    await handler.execute(interaction);
  } catch (err) {
    console.error('Error handling interaction:', err);
    if (interaction.isRepliable()) {
      try {
        await interaction.reply({ content: 'Command failed.', flags: MessageFlags.Ephemeral });
      } catch {
        try {
          await interaction.editReply({ content: 'Command failed.' });
        } catch {/* ignore */}
      }
    }
  }
});

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
              // No throw err; here to allow bot to respond with text if speech fails
              await msg.channel.send(finalReply); // Send text if speech fails
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

// Removed old presence logic and login
client.login(TOKEN); // Login is now the last step
