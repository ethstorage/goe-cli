import { StorageBackend, StorageConfig } from './types.js';

function encodeEntry(key: string, time: string): string {
    return JSON.stringify({
        key,
        lastUsedAt: time
    });
}

function decodeAndCheckEntry(encoded: string, idleTimeoutHours: number):
    { expired: true } | {
    key: string;
    needsUpdate: boolean;
} {
    try {
        const entry = JSON.parse(encoded);
        const idleTimeoutMs = idleTimeoutHours * 60 * 60 * 1000;
        const now = new Date();
        const lastUsed = new Date(entry.lastUsedAt);
        if (now.getTime() - lastUsed.getTime() > idleTimeoutMs) {
            return { expired: true };
        }

        return {
            key: entry.key,
            needsUpdate: true
        };
    } catch {
        return {
            key: encoded,
            needsUpdate: true
        };
    }
}

export async function createKeytarStore(config: StorageConfig): Promise<StorageBackend> {
    try {
        const keytarModule = await import('keytar') as any;
        const keytar = keytarModule.default || keytarModule;
        await keytar.getPassword(config.serviceName, '__test__');
        return {
            type: 'keytar',
            isAvailable: true,

            async saveKey(address: string, key: string): Promise<boolean> {
                await keytar.setPassword(config.serviceName, address, encodeEntry(key, new Date().toISOString()));
                return true;
            },

            async getKey(address: string): Promise<string | null> {
                const encoded = await keytar.getPassword(config.serviceName, address);
                if (!encoded) return null;

                const idleTimeoutHours = config.defaultIdleTimeoutHours;
                const result = decodeAndCheckEntry(encoded, idleTimeoutHours);
                if ('expired' in result && result.expired) {
                    await keytar.deletePassword(config.serviceName, address);
                    return null;
                }

                if (!('expired' in result) && result.needsUpdate) {
                    await keytar.setPassword(config.serviceName, address, encodeEntry(result.key, new Date().toISOString()));
                }

                return !('expired' in result) ? result.key : null;
            },

            async deleteKey(address: string): Promise<boolean> {
                return await keytar.deletePassword(config.serviceName, address);
            }
        };
    } catch (error: any) {
        return {
            type: 'keytar',
            isAvailable: false,
            error: error.message,

            async saveKey(): Promise<boolean> {
                throw new Error('Keytar is unavailable');
            },

            async getKey(): Promise<null> {
                return null;
            },

            async deleteKey(): Promise<boolean> {
                return false;
            }
        };
    }
}
