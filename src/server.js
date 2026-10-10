import 'dotenv/config';
import pino from 'pino';
import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHttpServer } from './http-server.js';
import { WhatsAppBot } from './whatsapp-bot.js';

const portValue = String(process.env.PORT ?? '3000');
if (!/^\d+$/.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}
const port = Number(portValue);
const defaultAuthDir = join(
  process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'),
  'whatsapp-command-bot',
  'auth',
);
const authDir = resolve(process.env.AUTH_DIR || defaultAuthDir);
const dashboardPassword = String(process.env.DASHBOARD_PASSWORD ?? '');
if (process.env.NODE_ENV === 'production' && dashboardPassword.trim().length < 16) {
  throw new Error('Set DASHBOARD_PASSWORD to a strong password of at least 16 characters in production.');
}
const logger = console;
const baileysLogger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' });

const bot = new WhatsAppBot({
  authDir,
  authStateLoader: useMultiFileAuthState,
  socketFactory: (options) => makeWASocket({
    ...options,
    logger: baileysLogger,
    printQRInTerminal: false,
  }),
  logger,
});

await bot.restore();
const server = createHttpServer({ bot, dashboardPassword, logger });
server.listen(port, '0.0.0.0', () => {
  console.log(`WhatsApp pairing dashboard is listening on port ${port}.`);
});

function shutdown(signal) {
  console.log(`${signal} received; shutting down.`);
  bot.shutdown();
  server.close();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
