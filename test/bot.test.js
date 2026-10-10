import assert from 'node:assert/strict';
import test from 'node:test';
import { BOT_PREFIX, extractMessageText, getCommandReply } from '../src/bot.js';

test('uses a hyphen as the bot command prefix', () => {
  assert.equal(BOT_PREFIX, '-');
  assert.match(getCommandReply('-ping'), /Pong/);
  assert.match(getCommandReply('  -PING  '), /Pong/);
  assert.equal(getCommandReply('ping'), null);
  assert.equal(getCommandReply('hello -ping'), null);
});

test('provides menu, help, about, time, echo, and unknown-command replies', () => {
  assert.match(getCommandReply('-menu'), /-ping/);
  assert.match(getCommandReply('-help'), /-echo/);
  assert.match(getCommandReply('-about'), /WhatsApp command bot/);
  assert.match(getCommandReply('-time'), /Current time/);
  assert.equal(getCommandReply('-echo hello there'), 'hello there');
  assert.match(getCommandReply('-echo'), /Usage/);
  assert.match(getCommandReply('-unknown'), /Unknown command/);
});

test('limits replies and extracts text from regular or wrapped messages', () => {
  assert.ok(getCommandReply(`-echo ${'😀'.repeat(3000)}`).length <= 4096);
  assert.equal(extractMessageText({ conversation: '-ping' }), '-ping');
  assert.equal(extractMessageText({ extendedTextMessage: { text: '-menu' } }), '-menu');
  assert.equal(extractMessageText({ ephemeralMessage: { message: { conversation: '-help' } } }), '-help');
  assert.equal(extractMessageText({ imageMessage: { caption: '-ping' } }), '-ping');
  assert.equal(extractMessageText({ imageMessage: { url: 'ignored' } }), '');
});
