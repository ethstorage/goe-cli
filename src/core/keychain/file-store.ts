import { homedir } from 'os';
import { join } from 'path';
import { promises as fs } from 'fs';
import { StoreEntry, StorageBackend, StorageConfig } from './types.js';

export class FileStorage implements StorageBackend {
    public type = 'file' as const;
    public isAvailable = true;

    private config: StorageConfig;
    private readonly storePath: string;

    constructor(config: StorageConfig) {
        this.config = config;
        this.storePath = join(homedir(), `.${config.serviceName}`, 'key_store.json');
    }

    async saveKey(address: string, key: string): Promise<boolean> {
        const store = await this.loadStore();
        const now = new Date().toISOString();
        store[address] = {
            key,
            lastUsedAt: now
        };

        await this.saveStore(store);
        return true;
    }

    async getKey(address: string): Promise<string | null> {
        const store = await this.loadStore();
        const entry = store[address];
        if (!entry) return null;

        const idleTimeoutMs = this.config.defaultIdleTimeoutHours * 60 * 60 * 1000;
        const key = this.checkAndUpdateEntry(entry, idleTimeoutMs);
        if (key === null) {
            // Key expired and was automatically removed.
            delete store[address];
            await this.saveStore(store);
            return null;
        }

        store[address] = entry;
        await this.saveStore(store);
        return key;
    }

    async deleteKey(address: string): Promise<boolean> {
        const store = await this.loadStore();

        if (!store[address]) return false;

        delete store[address];
        await this.saveStore(store);
        return true;
    }


    // private methods
    private async loadStore(): Promise<Record<string, StoreEntry>> {
        try {
            const dirPath = join(homedir(), `.${this.config.serviceName}`);
            await fs.mkdir(dirPath, { recursive: true });
            const content = await fs.readFile(this.storePath, 'utf8');
            return JSON.parse(content);
        } catch (error: any) {
            return {};
        }
    }

    private async saveStore(store: Record<string, StoreEntry>): Promise<void> {
        try {
            const dirPath = join(homedir(), `.${this.config.serviceName}`);
            await fs.mkdir(dirPath, { recursive: true });
            await fs.writeFile(this.storePath, JSON.stringify(store, null, 2), { mode: 0o600 });
        } catch (error: any) {
            throw error;
        }
    }

    private checkAndUpdateEntry(entry: StoreEntry, idleTimeoutMs: number): string | null {
        const now = new Date();
        const lastUsed = new Date(entry.lastUsedAt);
        if (now.getTime() - lastUsed.getTime() > idleTimeoutMs) {
            return null;
        }

        entry.lastUsedAt = now.toISOString();
        return entry.key;
    }
}
