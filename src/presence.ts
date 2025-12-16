import { ActivityType, PresenceUpdateStatus, Client } from 'discord.js';
import { isBotPaused } from './stateStore.js';
import { logger } from './logger.js';

// Helper function to get a random number in a range
const random = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min;

// Define the type for an activity object
interface ActivityOption {
  name: string;
  type: ActivityType;
  url?: string;
}

// Type for a function that can generate an activity, possibly using the client
type ActivityGenerator = (client: Client) => ActivityOption;

// Pool of possible statuses. Can be direct objects or functions that return an object.
const statusPool: Array<ActivityOption | ActivityGenerator> = [
  // Playing (active verbs, tasks, or games)
  () => ({ name: `TNT Tag with ${random(2, 10)} Creepers 🧨`, type: ActivityType.Playing }),
  () => ({ name: `Hide & Seek in the Nether 🌋`, type: ActivityType.Playing }),
  () => ({ name: `Minecraft hardcore mode ☠️`, type: ActivityType.Playing }),
  () => ({ name: `parkour maps 🏃‍♂️💨`, type: ActivityType.Playing }),

  // Watching (passive observation)
  () => ({ name: `the sunrise over mountains 🌄`, type: ActivityType.Watching }),
  () => ({ name: `grass grow... slowly 🌱`, type: ActivityType.Watching }),
  () => ({ name: `paint dry on wool 🎨🐑`, type: ActivityType.Watching }),

  // Listening (auditory experiences)
  () => ({ name: `C418's calm music 🎶`, type: ActivityType.Listening }),
  () => ({ name: `villagers going "hmm..." 🤔`, type: ActivityType.Listening }),
  () => ({ name: `zombie groans nearby 🧟`, type: ActivityType.Listening }),

  // Competing (challenges and records)
  () => ({ name: `in a mining race at Y=${random(-64, 16)} ⛏️💎`, type: ActivityType.Competing }),
  () => ({ name: `for most diamonds mined (${random(10, 500)}) 🥇`, type: ActivityType.Competing }),
  () => ({ name: `Elytra flight speedruns ⚡🪂`, type: ActivityType.Competing }),

  // Dynamic Ping
  (client: Client) => ({ name: `with ${Math.round(client.ws.ping)} ms ping 🚀`, type: ActivityType.Playing }),

  // Dynamic Time (Minecraft "Overworld time")
  () => ({
    name: `Overworld time ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} ⏰`,
    type: ActivityType.Watching
  }),

  // Streaming (shows purple badge, valid URL to your website)
  {
    name: `MinePal updates and news 🌟`,
    type: ActivityType.Streaming,
    url: 'https://minepal.net'
  }
];

const ROTATION_INTERVAL_MS = 1000 * 60 * 10;
let rotationTimer: NodeJS.Timeout | null = null;
let boundClient: Client | null = null;

function chooseActivity(client: Client): ActivityOption {
  const pick = statusPool[Math.floor(Math.random() * statusPool.length)];
  return typeof pick === 'function' ? (pick as ActivityGenerator)(client) : pick;
}

async function applyPresence(client: Client) {
  if (!client.user) {
    return;
  }
  try {
    const paused = await isBotPaused();
    if (paused) {
      await client.user.setPresence({
        status: PresenceUpdateStatus.Idle,
        activities: [
          {
            name: '⏸️ paused by admins',
            type: ActivityType.Watching,
          } as any,
        ],
      });
      return;
    }
    const activity = chooseActivity(client);
    await client.user.setPresence({
      status: PresenceUpdateStatus.Online,
      activities: [activity as any],
    });
  } catch (error) {
    logger.error('Failed to update presence', { error });
  }
}

export function startPresenceRotation(client: Client) {
  boundClient = client;
  if (rotationTimer) {
    clearInterval(rotationTimer);
    rotationTimer = null;
  }
  applyPresence(client);
  rotationTimer = setInterval(() => {
    applyPresence(client);
  }, ROTATION_INTERVAL_MS);
}

export async function refreshPresence(client?: Client) {
  const target = client ?? boundClient;
  if (!target) return;
  await applyPresence(target);
}