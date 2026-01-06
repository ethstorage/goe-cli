import { EncryptedWalletFile, DecryptedWallet } from './types.js';
import { encrypt, decrypt, deriveKey } from './crypto/index.js';
import { saveDecryptionKey, getDecryptionKey, deleteDecryptionKey } from './keychain/index.js';
import { saveEncryptedWallet, loadEncryptedWallet, listWalletAddresses } from './files.js';
import { generatePrivateKey } from './generator.js';

export class WalletManager {
    static async createWallet(password: string): Promise<{ address: string, privateKey: string }> {
        const { privateKey, address } = generatePrivateKey();

        const encryptedPrivateKey = encrypt(privateKey, password);

        // save password
        const salt = encryptedPrivateKey.split(':')[0];
        const decryptionKey = deriveKey(password, salt);
        await saveDecryptionKey(address, decryptionKey);

        // save wallet
        const walletFile: EncryptedWalletFile = {
            address,
            encryptedPrivateKey,
            type: 'privateKey',
            createdAt: new Date().toISOString()
        };
        saveEncryptedWallet(walletFile);

        return { address, privateKey };
    }

    static async unlockWallet(address: string, password: string): Promise<void> {
        const encryptedWallet = loadEncryptedWallet(address);
        const salt = encryptedWallet.encryptedPrivateKey.split(':')[0];
        const decryptionKey = deriveKey(password, salt);

        try {
            decrypt(encryptedWallet.encryptedPrivateKey, Buffer.from(decryptionKey, 'hex'));
        } catch (e) {
            throw new Error('Invalid password');
        }

        await saveDecryptionKey(address, decryptionKey);
    }

    static async lockWallet(address: string): Promise<void> {
        await deleteDecryptionKey(address);
    }

    static getDefaultAddress(): string | null {
        const addresses = listWalletAddresses();
        return addresses.length > 0 ? addresses[0] : null;
    }

    static async getWallet(): Promise<DecryptedWallet> {
        const address = this.getDefaultAddress();
        if (!address) throw new Error(`Wallet not found. Please run 'goe wallet create' to create it.`);

        const decryptionKey = await getDecryptionKey(address);
        if (!decryptionKey) throw new Error(`Wallet ${address} is locked. Please run 'goe wallet unlock' to unlock it.`);

        const encryptedWallet = loadEncryptedWallet(address);
        const privateKey = decrypt(
            encryptedWallet.encryptedPrivateKey,
            Buffer.from(decryptionKey, 'hex')
        );
        return {
            address,
            privateKey,
            type: encryptedWallet.type
        };
    }

    static async isUnlocked(address: string): Promise<boolean> {
        try {
            const key = await getDecryptionKey(address);
            return !!key;
        } catch {
            return false;
        }
    }

    static async listWalletsWithStatus(): Promise<{ address: string; unlocked: boolean }[]> {
        const addresses = listWalletAddresses();
        return await Promise.all(
            addresses.map(async (addr) => ({
                address: addr,
                unlocked: await this.isUnlocked(addr)
            }))
        );
    }
}

