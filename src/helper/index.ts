#!/usr/bin/env node

import GitRemoteHelper from './core/git-protocol.js';
import { createImpl } from './core/eth-api.js';

async function main() {
  let api;
  try {
    api = await createImpl(process.env);
    await GitRemoteHelper({
      stdin: process.stdin,
      api
    });
  } catch (err) {
    console.error('FATAL', err);
    process.exitCode = 1;
  } finally {
    if (api && typeof api.close === 'function') {
      await api.close();
    }
  }
}

main();
