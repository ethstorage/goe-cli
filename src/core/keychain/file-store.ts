import {createHash, scryptSync, randomBytes, createCipheriv, createDecipheriv} from 'crypto';
import {arch, homedir, platform, release} from 'os';
import {promises as fs, readFileSync} from 'fs';
import {join} from 'path';
import {execSync} from 'child_process';
import {StorageBackend, StorageConfig, StoreEntry} from './types.js';

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

        const idleTimeoutMs = this.config.defaultIdleTimeoutHours * 60 * 60 * 1000;
        const key = this.checkAndUpdateEntry(entry, idleTimeoutMs);
        if (key === null) {
            // Key expired and was automatically removed.
            delete store[address];
            await this.saveStore(store);
            return null;
        }

        try {
            const decryptedKey = this.decryptWithMachineKey(entry.key);
            store[address] = entry;
            await this.saveStore(store);
            return decryptedKey;
        } catch (error) {
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


    private getMachineFingerprint(): string {
        const components = [
            homedir(),                    // 用户主目录
            platform(),                   // 操作系统
            arch(),                       // 系统架构
            release(),                    // 内核版本
            process.getuid?.() || '0',    // 用户ID（如果可用）
        ];

        try {
            // Linux
            if (platform() === 'linux') {
                const machineId = readFileSync('/etc/machine-id', 'utf8').trim();
                components.push(machineId);
            }
            // macOS
            if (platform() === 'darwin') {
                const serial = execSync('system_profiler SPHardwareDataType | grep "Serial Number"', { encoding: 'utf8' });
                components.push(serial.trim());
            }
        } catch (error) {}
        return createHash('sha256')
            .update(components.join('|'))
            .digest('hex');
    }

    private deriveMachineKey(): Buffer {
        const fingerprint = this.getMachineFingerprint();
        return scryptSync(
            fingerprint,
            'goe-cli-machine-salt',
            32,
            { N: 32768, r: 8, p: 1 }
        ) as Buffer;
    }

    private encryptWithMachineKey(plaintext: string): string {
        const machineKey = this.deriveMachineKey();
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
    }

    private decryptWithMachineKey(ciphertext: string): string {
        const [ivHex, authTagHex, encrypted] = ciphertext.split(':');

        const machineKey = this.deriveMachineKey();
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');

        const decipher = createDecipheriv('aes-256-gcm', machineKey, iv, { authTagLength: 16 });
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }
}
