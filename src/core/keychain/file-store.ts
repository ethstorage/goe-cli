import { createHash, scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { homedir, platform } from 'os';
import { promises as fs, readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { StorageBackend, StorageConfig, StoreEntry } from './types.js';

export class FileStorage implements StorageBackend {
    public type = 'file' as const;
    public isAvailable = true;

    private config: StorageConfig;
    private readonly storePath: string;

    constructor(config: StorageConfig) {
        this.config = config;
        this.storePath = join(homedir(), `.${config.serviceName}`, 'key_store.json');
    }

    async saveKey(address: string, decryptionKey: string): Promise<boolean> {
        const store = await this.loadStore();
        const now = new Date().toISOString();
        const encryptedKey = this.encryptWithMachineKey(decryptionKey);
        store[address] = {
            key: encryptedKey,
            lastUsedAt: now
        };

        await this.saveStore(store);
        return true;
    }

    async getKey(address: string): Promise<string | null> {
        const store = await this.loadStore();
        const entry = store[address];
        if (!entry) return null;

        const idleTimeoutMs = (this.config.defaultIdleTimeoutHours || 2) * 60 * 60 * 1000;
        const now = new Date();
        const lastUsed = new Date(entry.lastUsedAt);
        if (now.getTime() - lastUsed.getTime() > idleTimeoutMs) {
            delete store[address];
            await this.saveStore(store);
            return null;
        }

        try {
            const decryptedKey = this.decryptWithMachineKey(entry.key);
            // decrypted success
            entry.lastUsedAt = now.toISOString();
            store[address] = entry;
            await this.saveStore(store);
            return decryptedKey;
        } catch (error) {
            delete store[address];
            await this.saveStore(store);
            return null;
        }
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
            // If file missing or parse error, return empty store to avoid throwing
            return {};
        }
    }

    // atomic write: write tmp file then rename
    private async saveStore(store: Record<string, StoreEntry>): Promise<void> {
        try {
            const dirPath = join(homedir(), `.${this.config.serviceName}`);
            await fs.mkdir(dirPath, { recursive: true });
            const tmp = `${this.storePath}.tmp`;
            await fs.writeFile(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
            await fs.rename(tmp, this.storePath);
        } catch (error: any) {
            throw error;
        }
    }

    private getMachineFingerprint(): string {
        // Build a stable machine identifier with best-effort approach.
        // Prefer /etc/machine-id on Linux, ioreg on macOS, wmic on Windows.
        // Fallback to hostname only if others unavailable.
        const parts: string[] = [];

        const plt = platform();
        try {
            if (plt === 'linux') {
                try {
                    const machineId = readFileSync('/etc/machine-id', 'utf8').trim();
                    if (machineId) parts.push(`linux:${machineId}`);
                } catch (e) {
                    // fallback to hostname
                    try { parts.push(`linux-host:${execSync('hostname', { encoding: 'utf8' }).trim()}`); } catch (e2) {}
                }
            } else if (plt === 'darwin') {
                try {
                    // use ioreg to fetch serial number (more stable than system_profiler+grep)
                    const serial = execSync('ioreg -rd1 -c IOPlatformExpertDevice | awk -F\\" \'/IOPlatformSerialNumber/ {print $4}\'', { encoding: 'utf8' }).trim();
                    if (serial) parts.push(`mac:${serial}`);
                } catch (e) {
                    try { parts.push(`mac-host:${execSync('hostname', { encoding: 'utf8' }).trim()}`); } catch (e2) {}
                }
            } else if (plt.startsWith('win')) {
                try {
                    const out = execSync('wmic csproduct get UUID', { encoding: 'utf8' });
                    const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                    if (lines.length >= 2) {
                        const uuid = lines[1];
                        if (uuid) parts.push(`win:${uuid}`);
                    }
                } catch (e) {
                    try { parts.push(`win-host:${execSync('hostname', { encoding: 'utf8' }).trim()}`); } catch (e2) {}
                }
            }
        } catch (e) {
            // ignore any platform-specific errors
        }

        // final fallback
        if (parts.length === 0) {
            try {
                const host = execSync('hostname', { encoding: 'utf8' }).trim();
                parts.push(`host:${host}`);
            } catch (e) {
                parts.push('fallback:unknown');
            }
        }

        return createHash('sha256').update(parts.join('|')).digest('hex');
    }

    private deriveMachineKey(): Buffer {
        const fingerprint = this.getMachineFingerprint();
        const isMemoryConstrained = process.env.CI === 'true' ||
            process.env.DOCKER === 'true' ||
            process.memoryUsage().heapTotal < 100 * 1024 * 1024;
        const params = isMemoryConstrained
            ? { N: 8192, r: 8, p: 1 }
            : { N: 16384, r: 8, p: 1 };

        return scryptSync(
            fingerprint,
            'goe-cli-machine-salt',
            32,
            params
        ) as Buffer;
    }

    private encryptWithMachineKey(plaintext: string): string {
        const machineKey = this.deriveMachineKey();
        try {
            const iv = randomBytes(12);

            const cipher = createCipheriv('aes-256-gcm', machineKey, iv, { authTagLength: 16 });
            let encrypted = cipher.update(plaintext, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            const authTag: Buffer = cipher.getAuthTag() as Buffer;
            return [
                (iv as Buffer).toString('hex'),
                authTag.toString('hex'),
                encrypted
            ].join(':');
        } finally {
            try { machineKey.fill(0); } catch (e) {}
        }
    }

    private decryptWithMachineKey(ciphertext: string): string {
        const parts = ciphertext.split(':');
        if (parts.length !== 3) throw new Error('Malformed ciphertext format');

        const [ivHex, authTagHex, encrypted] = parts;

        const machineKey = this.deriveMachineKey();
        try {
            const iv = Buffer.from(ivHex, 'hex');
            const authTag = Buffer.from(authTagHex, 'hex');

            const decipher = createDecipheriv('aes-256-gcm', machineKey, iv, { authTagLength: 16 });
            decipher.setAuthTag(authTag);

            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');

            return decrypted;
        } finally {
            try { machineKey.fill(0); } catch (e) {}
        }
    }
}
