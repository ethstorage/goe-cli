import { createHash } from 'crypto';
import { homedir } from 'os';
import { createKeytarStore } from './keytar-store.js';
import { FileStorage } from './file-store.js';
import { StorageBackend, StorageConfig } from './types.js';

const DEFAULT_IDLE_TIMEOUT_HOURS = 24;
const userHash = createHash('sha256')
    .update(homedir())
    .digest('hex')
    .slice(0, 8);
const SERVICE_NAME = `goe-cli-${userHash}`;

const config: StorageConfig = {
    defaultIdleTimeoutHours: DEFAULT_IDLE_TIMEOUT_HOURS,
    serviceName: SERVICE_NAME
};

let storage: StorageBackend | null = null;

async function initializeStorage(): Promise<StorageBackend> {
    if (storage) return storage;

    const keytarStore = await createKeytarStore(config);
    if (keytarStore.isAvailable) {
        storage = keytarStore;
    } else {
        storage = new FileStorage(config);
    }
    return storage;
}

async function getStorage(): Promise<StorageBackend> {
    if (!storage) {
        await initializeStorage();
    }
    return storage!;
}

export async function saveDecryptionKey(address: string, key: string): Promise<void> {
    const store = await getStorage();
    await store.saveKey(address, key);
}

export async function getDecryptionKey(address: string): Promise<string | null> {
    const store = await getStorage();
    return store.getKey(address);
}

export async function deleteDecryptionKey(address: string): Promise<boolean> {
    const store = await getStorage();
    return store.deleteKey(address);
}
