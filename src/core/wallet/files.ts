import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { EncryptedWalletFile } from '../types/wallet.js';

const WALLET_ROOT = join(homedir(), '.eths', 'wallets');

function ensureWalletDir(): void {
    if (!existsSync(WALLET_ROOT)) {
        mkdirSync(WALLET_ROOT, { recursive: true, mode: 0o700 });
    }
}

export function saveEncryptedWallet(wallet: EncryptedWalletFile): void {
    ensureWalletDir();
    const filePath = join(WALLET_ROOT, `${wallet.address}.json`);
    writeFileSync(filePath, JSON.stringify(wallet, null, 2), { mode: 0o600 });
}

export function loadEncryptedWallet(address: string): EncryptedWalletFile {
    const filePath = join(WALLET_ROOT, `${address}.json`);
    if (!existsSync(filePath)) {
        throw new Error(`Wallet ${address} not found. Create one with 'eths wallet create'`);
    }
    return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function listWalletAddresses(): string[] {
    if (!existsSync(WALLET_ROOT)) return [];
    return readdirSync(WALLET_ROOT)
        .filter(filename => filename.endsWith('.json'))
        .map(filename => filename.replace('.json', ''));
}
