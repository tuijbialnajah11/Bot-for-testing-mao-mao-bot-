import { chmod, mkdir, rm } from 'node:fs/promises';
import { extractMessageText, getCommandReply } from './bot.js';

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function normalizePhoneNumber(value) {
  if (typeof value !== 'string') {
    throw httpError('Enter a phone number with its country code.', 400);
  }

  const input = value.trim();
  if (!input || !/^\+?[\d\s()-]+$/.test(input)) {
    throw httpError('Use an international number, for example +91 98765 43210.', 400);
  }

  const digits = input.replace(/\D/g, '');
  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    throw httpError('The number must include its country code and contain 8 to 15 digits.', 400);
  }

  return digits;
}

function phoneFromCredentials(authState) {
  const id = authState?.creds?.me?.id;
  if (typeof id !== 'string') return '';
  return `+${id.split('@')[0].split(':')[0]}`;
}

export class WhatsAppBot {
  constructor({ authDir, authStateLoader, socketFactory, logger = console }) {
    if (!authDir || typeof authStateLoader !== 'function' || typeof socketFactory !== 'function') {
      throw new TypeError('WhatsAppBot requires authDir, authStateLoader, and socketFactory.');
    }

    this.authDir = authDir;
    this.authStateLoader = authStateLoader;
    this.socketFactory = socketFactory;
    this.logger = logger;
    this.socket = null;
    this.pendingOperation = null;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.shuttingDown = false;
    this.generation = 0;
    this.intentionalSockets = new WeakSet();
    this.status = {
      state: 'idle',
      phoneNumber: '',
      pairingCode: '',
      message: 'Enter your number to pair this bot with WhatsApp.',
    };
  }

  getStatus() {
    return { ...this.status };
  }

  async restore() {
    try {
      const authState = await this.#loadAuthState();
      if (!authState.state.creds.registered) {
        this.#setStatus('idle', 'Enter your number to pair this bot with WhatsApp.');
        return;
      }

      this.#setStatus(
        'connecting',
        'Restoring the saved WhatsApp session…',
        { phoneNumber: phoneFromCredentials(authState.state) },
      );
      this.#attachSocket(authState);
    } catch (error) {
      this.logger.error?.(`Could not restore WhatsApp session: ${error?.message ?? error}`);
      this.#setStatus('error', 'Could not read the saved WhatsApp session. Check the auth directory and restart.');
    }
  }

  requestPairingCode(value) {
    const phoneNumber = normalizePhoneNumber(value);
    if (this.pendingOperation || ['connecting', 'pairing', 'connected', 'disconnecting'].includes(this.status.state)) {
      throw httpError('A WhatsApp session is already starting or connected. Disconnect it before pairing another number.', 409);
    }

    this.shuttingDown = false;
    const generation = ++this.generation;
    this.#setStatus('connecting', 'Connecting to WhatsApp and requesting a pairing code…', {
      phoneNumber: `+${phoneNumber}`,
    });

    const operation = this.#requestPairingCode(phoneNumber, generation);
    this.pendingOperation = operation;
    operation.finally(() => {
      if (this.pendingOperation === operation) {
        this.pendingOperation = null;
      }
    }).catch(() => {});

    return operation;
  }

  async #requestPairingCode(phoneNumber, generation) {
    let socket;
    try {
      const authState = await this.#loadAuthState();
      if (generation !== this.generation) return;
      if (authState.state.creds.registered) {
        this.#setStatus('connecting', 'A saved WhatsApp session was found; reconnecting it now.', {
          phoneNumber: phoneFromCredentials(authState.state) || `+${phoneNumber}`,
        });
        this.#attachSocket(authState);
        return;
      }

      socket = this.#attachSocket(authState);
      const pairingCode = await socket.requestPairingCode(phoneNumber);
      if (generation !== this.generation) return;
      if (this.socket !== socket) {
        throw new Error('WhatsApp disconnected before the pairing code was ready. Please try again.');
      }

      if (this.status.state !== 'connected') {
        this.#setStatus('pairing', 'Code ready. Enter it in WhatsApp on your phone.', {
          phoneNumber: `+${phoneNumber}`,
          pairingCode,
        });
      }
    } catch (error) {
      if (socket && this.socket === socket) {
        this.#closeSocket(socket);
      }
      if (generation !== this.generation) {
        throw error;
      }
      if (this.status.state !== 'connected') {
        this.#setStatus('error', error?.message || 'Could not create a pairing code. Please try again.', {
          phoneNumber: `+${phoneNumber}`,
        });
      }
      throw error;
    }
  }

  async disconnect() {
    this.generation += 1;
    this.#clearReconnectTimer();
    this.#setStatus('disconnecting', 'Disconnecting and clearing the saved session…', {
      phoneNumber: this.status.phoneNumber,
    });

    const socket = this.socket;
    this.socket = null;
    if (socket) {
      this.intentionalSockets.add(socket);
      try {
        await Promise.race([
          Promise.resolve(socket.logout?.()).catch(() => {}),
          new Promise((resolve) => {
            const timer = setTimeout(resolve, 2500);
            timer.unref?.();
          }),
        ]);
      } catch {
        // Removing the local credentials is still useful if WhatsApp is unreachable.
      }
      try {
        socket.end?.(new Error('Session reset by the user.'));
      } catch {
        // The socket may already be closed.
      }
    }

    await rm(this.authDir, { recursive: true, force: true });
    this.reconnectAttempt = 0;
    this.#setStatus('idle', 'Session cleared. Enter your number to pair again.');
  }

  shutdown() {
    this.generation += 1;
    this.shuttingDown = true;
    this.#clearReconnectTimer();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      this.intentionalSockets.add(socket);
      try {
        socket.end?.(new Error('Bot server is shutting down.'));
      } catch {
        // The socket may already be closed.
      }
    }
  }

  async #loadAuthState() {
    await mkdir(this.authDir, { recursive: true, mode: 0o700 });
    try {
      await chmod(this.authDir, 0o700);
    } catch {
      // Some filesystems do not support POSIX permissions.
    }
    return this.authStateLoader(this.authDir);
  }

  #attachSocket(authState) {
    const socket = this.socketFactory({
      auth: authState.state,
      printQRInTerminal: false,
      syncFullHistory: false,
    });
    this.socket = socket;

    socket.ev.on('creds.update', (update) => {
      void authState.saveCreds(update).catch((error) => {
        this.logger.error?.(`Could not save WhatsApp credentials: ${error?.message ?? error}`);
      });
    });

    socket.ev.on('messages.upsert', (event) => {
      void this.#handleMessages(socket, event);
    });

    socket.ev.on('connection.update', (update) => {
      this.#handleConnectionUpdate(socket, authState, update);
    });

    return socket;
  }

  async #handleMessages(socket, event) {
    if (this.socket !== socket || event?.type !== 'notify' || !Array.isArray(event.messages)) {
      return;
    }

    for (const message of event.messages) {
      const chatId = message?.key?.remoteJid;
      if (!chatId || chatId === 'status@broadcast' || message.key.fromMe) {
        continue;
      }

      const text = extractMessageText(message.message);
      const reply = getCommandReply(text);
      if (!reply) {
        continue;
      }

      try {
        await socket.sendMessage(chatId, { text: reply });
      } catch (error) {
        this.logger.error?.(`Could not reply to a WhatsApp command: ${error?.message ?? error}`);
      }
    }
  }

  #handleConnectionUpdate(socket, authState, update) {
    if (this.socket !== socket) return;

    if (update.connection === 'open') {
      this.reconnectAttempt = 0;
      this.#setStatus('connected', 'WhatsApp is connected. Send -menu in a chat to see commands.', {
        phoneNumber: this.status.phoneNumber || phoneFromCredentials(authState.state),
      });
      return;
    }

    if (update.connection !== 'close') return;

    this.socket = null;
    if (this.intentionalSockets.has(socket) || this.shuttingDown) return;

    const statusCode = update.lastDisconnect?.error?.output?.statusCode;
    if (statusCode === 401) {
      this.#setStatus('disconnected', 'WhatsApp signed this session out. Disconnect and reset it before pairing again.', {
        phoneNumber: this.status.phoneNumber || phoneFromCredentials(authState.state),
      });
      return;
    }

    if (!authState.state.creds.registered) {
      this.#setStatus('error', 'Connection closed before pairing finished. Request a new pairing code.', {
        phoneNumber: this.status.phoneNumber,
      });
      return;
    }

    this.#scheduleReconnect();
  }

  #scheduleReconnect() {
    if (this.shuttingDown || this.reconnectTimer) return;

    const generation = this.generation;
    const delay = Math.min(30_000, 1000 * (2 ** Math.min(this.reconnectAttempt, 5)));
    this.reconnectAttempt += 1;
    this.#setStatus('connecting', 'Connection lost. Reconnecting to WhatsApp…', {
      phoneNumber: this.status.phoneNumber,
    });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.shuttingDown || generation !== this.generation) return;

      try {
        const authState = await this.#loadAuthState();
        if (this.shuttingDown || generation !== this.generation) return;
        if (!authState.state.creds.registered) {
          this.#setStatus('idle', 'No linked WhatsApp session was found. Enter your number to pair.');
          return;
        }
        this.#attachSocket(authState);
      } catch (error) {
        this.logger.error?.(`Could not reconnect to WhatsApp: ${error?.message ?? error}`);
        this.#scheduleReconnect();
      }
    }, delay);
    this.reconnectTimer.unref?.();
  }

  #clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  #closeSocket(socket) {
    if (this.socket !== socket) return;
    this.intentionalSockets.add(socket);
    this.socket = null;
    try {
      socket.end?.(new Error('Pairing attempt ended.'));
    } catch {
      // The socket may already be closed.
    }
  }

  #setStatus(state, message, overrides = {}) {
    this.status = {
      state,
      phoneNumber: state === 'idle' ? (overrides.phoneNumber ?? '') : (overrides.phoneNumber ?? this.status.phoneNumber ?? ''),
      pairingCode: state === 'pairing' ? (overrides.pairingCode ?? '') : '',
      message,
    };
  }
}
