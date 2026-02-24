import fs from 'node:fs/promises';
import type { REST } from '@discordjs/rest';
import { RAW_SAFE_ALLOWED_MENTIONS } from '../utils/allowedMentions.js';

interface AttachmentSlot {
  id: string;
  upload_filename: string;
  upload_url: string;
}

interface ChannelAttachmentsResponse {
  attachments: AttachmentSlot[];
}

export async function sendVoiceMessage(
  rest: REST,
  channelId: string,
  filePath: string,
  seconds: number,
  audioFileName: string,
  attachmentTitle: string
): Promise<void> {
  const buf = await fs.readFile(filePath);
  const { attachments: [slot] } = await rest.post(
    `/channels/${channelId}/attachments`,
    { body: { files: [{ id: '0', filename: audioFileName, file_size: buf.length }] } }
  ) as ChannelAttachmentsResponse;

  await fetch(slot.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/ogg' },
    body: buf as any,
  });

  const waveform = Buffer.alloc(256, 128).toString('base64');

  await rest.post(
    `/channels/${channelId}/messages`,
    {
      body: {
        flags: 1 << 13,
        attachments: [{
          id: '0',
          filename: audioFileName,
          uploaded_filename: slot.upload_filename,
          duration_secs: seconds,
          waveform,
          title: `Voice message: ${attachmentTitle}`,
        }],
        allowed_mentions: RAW_SAFE_ALLOWED_MENTIONS,
      }
    }
  );
}
