import { EncryptedWalletFile, DecryptedWallet } from '../types/wallet.js';
import { encrypt, decrypt, deriveKey } from '../crypto/index.js';
import { saveDecryptionKey, getDecryptionKey, deleteDecryptionKey } from '../keychain/index.js';
import {saveEncryptedWallet, loadEncryptedWallet, listWalletAddresses} from './files.js';
import { generatePrivateKey } from './generator.js';

export async function createPrivateKeyWallet(password: string): Promise<{ address: string, privateKey: string }> {
    const { privateKey, address } = generatePrivateKey();

    const encryptedPrivateKey = encrypt(privateKey, password);
    const walletFile: EncryptedWalletFile = {
        address,
        encryptedPrivateKey,
        type: 'privateKey',
        createdAt: new Date().toISOString()
    };
    saveEncryptedWallet(walletFile);

    const salt = encryptedPrivateKey.split(':')[0];
    const decryptionKey = deriveKey(password, salt);
    await saveDecryptionKey(address, decryptionKey);

    return {address, privateKey};
}

export async function manualUnlockWallet(address: string, password: string): Promise<void> {
    const encryptedWallet = loadEncryptedWallet(address);
    const salt = encryptedWallet.encryptedPrivateKey.split(':')[0];
    const decryptionKey = deriveKey(password, salt);

    try {
        decrypt(encryptedWallet.encryptedPrivateKey, Buffer.from(decryptionKey, 'hex').toString('utf8'));
    } catch (e) {
        throw new Error('Invalid password');
    }

    await saveDecryptionKey(address, decryptionKey);
}

export async function lockWallet(address: string): Promise<void> {
    await deleteDecryptionKey(address);
}

export async function getWallet(): Promise<DecryptedWallet> {
    const addresses = listWalletAddresses();
    if (addresses.length < 1) {
        throw new Error(`Wallet not found. Please run 'eths wallet create' to create it.`);
    }

    const address = addresses[0];
    const decryptionKey = await getDecryptionKey(address);
    if (!decryptionKey) {
        throw new Error(`Wallet ${address} is locked. Run 'eths wallet unlock <address>'`);
    }

    const encryptedWallet = loadEncryptedWallet(address);
    const privateKey = decrypt(
        encryptedWallet.encryptedPrivateKey,
        Buffer.from(decryptionKey, 'hex').toString('utf8')
    );

    return {
        address,
        privateKey,
        type: encryptedWallet.type
    };
}
