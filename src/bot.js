export const BOT_PREFIX = '-';
const MAX_REPLY_LENGTH = 4096;

const MENU = [
  '🤖 *WhatsApp Bot — command menu*',
  '',
  '-ping  Check that the bot is online',
  '-menu  Show this command menu',
  '-help  Show the command menu',
  '-about  About this bot',
  '-time  Show the current time',
  '-echo <text>  Echo your text',
].join('\n');

function truncate(text) {
  if (text.length <= MAX_REPLY_LENGTH) {
    return text;
  }

  let end = MAX_REPLY_LENGTH - 1;
  const lastCodeUnit = text.charCodeAt(end - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
    end -= 1;
  }
  return `${text.slice(0, end)}…`;
}

export function getCommandReply(input) {
  if (typeof input !== 'string') {
    return null;
  }

  const text = input.trim();
  if (!text.startsWith(BOT_PREFIX)) {
    return null;
  }

  const [rawCommand = '', ...args] = text.slice(BOT_PREFIX.length).trim().split(/\s+/);
  const command = rawCommand.toLowerCase();
  const argumentText = args.join(' ');

  switch (command) {
    case 'ping':
      return '🏓 Pong! The bot is online.';
    case 'menu':
    case 'help':
      return MENU;
    case 'about':
      return 'I am a small WhatsApp command bot. My commands use the - prefix. Send -menu to see what I can do.';
    case 'time':
      return `Current time: ${new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'medium',
        timeZone: 'Asia/Kolkata',
      }).format(new Date())}`;
    case 'echo':
      return argumentText
        ? truncate(argumentText)
        : 'Usage: -echo <text>';
    case '':
      return 'Send -menu to see the available commands.';
    default:
      return truncate(`Unknown command: -${rawCommand}. Send -menu to see the available commands.`);
  }
}

export function extractMessageText(content) {
  let current = content;

  // WhatsApp can wrap text in ephemeral/view-once message containers.
  for (let depth = 0; current && depth < 6; depth += 1) {
    if (typeof current.conversation === 'string') return current.conversation;
    if (typeof current.extendedTextMessage?.text === 'string') return current.extendedTextMessage.text;
    if (typeof current.imageMessage?.caption === 'string') return current.imageMessage.caption;
    if (typeof current.videoMessage?.caption === 'string') return current.videoMessage.caption;
    if (typeof current.documentMessage?.caption === 'string') return current.documentMessage.caption;
    if (typeof current.buttonsResponseMessage?.selectedDisplayText === 'string') return current.buttonsResponseMessage.selectedDisplayText;
    if (typeof current.listResponseMessage?.title === 'string') return current.listResponseMessage.title;

    current = current.ephemeralMessage?.message
      ?? current.viewOnceMessage?.message
      ?? current.viewOnceMessageV2?.message
      ?? current.documentWithCaptionMessage?.message;
  }

  return '';
}
