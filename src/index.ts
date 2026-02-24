import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Events,
} from "discord.js";
import { REST } from "@discordjs/rest";
import { startPresenceRotation } from './presence.js';
import { logger } from './logger.js';
import { registerSlashCommands } from './handlers/registerSlashCommands.js';
import { registerInteractionHandler } from './handlers/interactionHandler.js';
import { registerMessageHandler } from './handlers/messageHandler.js';

const TOKEN = process.env.DISCORD_TOKEN!;
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // needs the MESSAGE CONTENT privileged intent enabled
  ],
});

const rest = new REST({ version: '10' })
  .setToken(TOKEN);

client.once(Events.ClientReady, async (readyClient) => {
  logger.info(`Logged in as ${readyClient.user.tag}`);
  if (readyClient.user) {
    startPresenceRotation(readyClient);
  }
  await registerSlashCommands(readyClient, rest);
});

registerInteractionHandler(client);
registerMessageHandler(client, rest);
client.login(TOKEN);
