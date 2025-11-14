import keytar from 'keytar';
import { createHash } from 'crypto';
import { homedir } from 'os';

const userHash = createHash('sha256')
    .update(homedir())
    .digest('hex')
    .slice(0, 8);

const SERVICE_NAME = `goe-cli-${userHash}`;

export async function saveDecryptionKey(address: string, key: string): Promise<void> {
    await keytar.setPassword(SERVICE_NAME, address, key);
}

export async function getDecryptionKey(address: string): Promise<string | null> {
    return keytar.getPassword(SERVICE_NAME, address);
}

export async function deleteDecryptionKey(address: string): Promise<boolean> {
    return keytar.deletePassword(SERVICE_NAME, address);
}
