export function sanitizeDiscordMentions(text: string): string {
  if (!text) return text;
  return text
    .replace(/@everyone/gi, 'at everyone')
    .replace(/@here/gi, 'at here');
}
