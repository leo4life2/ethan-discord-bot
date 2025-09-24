import { EDITOR_ROLE_ID, EDITOR_USER_IDS } from '../config.js';

export function hasEditorPermission(interaction: any): boolean {
  if (!interaction || typeof interaction.inGuild !== 'function' || !interaction.inGuild()) {
    return false;
  }
  if (Array.isArray(EDITOR_USER_IDS) && EDITOR_USER_IDS.includes(interaction.user.id)) {
    return true;
  }
  const roles = interaction.member?.roles?.cache;
  return typeof roles?.has === 'function' ? roles.has(EDITOR_ROLE_ID) === true : false;
}

