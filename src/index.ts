#!/usr/bin/env node

import GitRemoteHelper from './core/git-protocol.js';
import { createImpl } from './core/eth-api.js';

async function main() {
  const api = await createImpl(process.env);
  try {
    await GitRemoteHelper({
      stdin: process.stdin,
      api
    });
  } catch (err) {
    console.error('FATAL', err);
    process.exitCode = 1;
  } finally {
    if (typeof api.close === 'function') {
      await api.close();
    }
  }
}

main();
