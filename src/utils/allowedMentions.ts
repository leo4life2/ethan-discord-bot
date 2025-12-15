import type { AllowedMentionsTypes, MessageMentionOptions } from 'discord.js';

const MINI_MOD_ALERT_ROLE_IDS = Object.freeze(['1421497577450377276']);

const baseAllowedMentions: MessageMentionOptions = {
  parse: [] as AllowedMentionsTypes[],
  users: [] as string[],
  roles: [...MINI_MOD_ALERT_ROLE_IDS],
  repliedUser: false,
};

export const SAFE_ALLOWED_MENTIONS = Object.freeze(baseAllowedMentions);

export const RAW_SAFE_ALLOWED_MENTIONS = Object.freeze({
  parse: [] as string[],
  users: [] as string[],
  roles: [...MINI_MOD_ALERT_ROLE_IDS],
  replied_user: false,
});

export const MENTIONABLE_ROLE_IDS = MINI_MOD_ALERT_ROLE_IDS;

