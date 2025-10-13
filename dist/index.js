#!/usr/bin/env node
import GitRemoteHelper from './core/git-protocol.js';
import { createImpl } from './core/eth-api.js';
async function main() {
    const api = await createImpl(process.env);
    await GitRemoteHelper({
        stdin: process.stdin,
        api
    }).catch(err => {
        console.error('FATAL', err);
        process.exit(1);
    });
}
main();
