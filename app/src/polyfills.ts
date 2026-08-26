import { Buffer } from 'buffer';

globalThis.Buffer = Buffer;

if (typeof globalThis.process === 'undefined') {
  // minimal shim for browser builds of Solana/web3-adapter libs
  (globalThis as unknown as { process: unknown }).process = {
    env: { NODE_ENV: (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE ?? 'development' },
    browser: true,
    nextTick: (fn: (...a: unknown[]) => void, ...a: unknown[]) => setTimeout(() => fn(...a), 0),
    version: '',
    platform: 'browser',
  };
}
