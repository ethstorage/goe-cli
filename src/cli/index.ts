#!/usr/bin/env node

import { program } from 'commander';
import pkg from '../../package.json' with { type: 'json' };

import { promptPassword } from "./utils.js";
import {
    createPrivateKeyWallet,
    lockWallet,
    manualUnlockWallet,
    listWalletAddresses
} from "../core/wallet/index.js";

program
    .version(pkg.version, '-v, --version')
    .description('Ethereum-backed Git remote helper & CLI');

const walletCmd = program.command('wallet').description('Manage Ethereum wallets');

walletCmd
    .command('create')
    .description('Create a new private key wallet')
    .action(async () => {
        try {
            const addresses = listWalletAddresses();
            if (addresses && addresses.length > 0) {
                console.error('❌ Wallet already exists.');
                process.exit(1);
            }

            const password = promptPassword('Enter password to encrypt wallet: ');
            const confirm = promptPassword('Confirm password: ');
            if (password !== confirm) {
                console.error('❌ Passwords do not match');
                process.exit(1);
            }

            const {address, privateKey} = await createPrivateKeyWallet(password);
            console.log(`\n✅ Wallet created successfully!`);
            console.log(`   Address: ${address}\n`);
            console.log(`⚠️  IMPORTANT! Your private key is shown below. KEEP IT SAFE!\n`);
            console.log(`   ${privateKey}\n`);

            console.log(
                `💡 Please save your private key securely.
   - Do NOT share it with anyone.
   - Losing it means you will permanently lose access to your wallet and funds.
   - Consider storing it in a secure password manager or offline safe location.\n`
            );
        } catch (e) {
            console.error(`❌ Error: ${(e as Error).message}`);
            process.exit(1);
        }
    });

walletCmd
    // .command('unlock <address>')
    .command('unlock')
    .description('Unlock a wallet (cache decryption key)')
    .action(async () => {
        try {
            const addresses = listWalletAddresses();
            if (!addresses || addresses.length === 0) {
                console.error("❌ Wallet not found. Please run 'eths wallet create' to create it.");
                process.exit(1);
            }

            const password = promptPassword('Enter wallet password: ');
            const address = addresses[0];
            await manualUnlockWallet(address, password);
            console.log(`✅ Wallet ${address} unlocked`);
        } catch (e) {
            console.error(`❌ Error: ${(e as Error).message}`);
            process.exit(1);
        }
    });

walletCmd
    // .command('lock <address>')
    .command('lock')
    .description('Lock a wallet (remove cached key)')
    .action(async () => {
        try {
            const addresses = listWalletAddresses();
            if (!addresses || addresses.length === 0) {
                console.error("❌ Wallet not found. Please run 'eths wallet create' to create it.");
                process.exit(1);
            }

            const address = addresses[0];
            await lockWallet(address);
            console.log(`✅ Wallet ${address} locked`);
        } catch (e) {
            console.error(`❌ Error: ${(e as Error).message}`);
            process.exit(1);
        }
    });

walletCmd
    .command('list')
    .description('List all wallets')
    .action(() => {
        const addresses = listWalletAddresses();
        if (addresses.length === 0) {
            console.log('No wallets found. Create one with `eths wallet create`');
            return;
        }
        console.log('Wallets:');
        addresses.forEach(addr => console.log(`- ${addr}`));
    });

program.parse(process.argv);
