import { spawnSync } from 'child_process';
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

function checkKeytarHealth(): boolean {
    const probeScript = `
        process.on('unhandledRejection', () => process.exit(1));
        try {
            const keytar = (await import('keytar')).default;
            const service = 'goe-cli-probe-${Math.random().toString(36).slice(2, 6)}';
            await keytar.setPassword(service, 't', 'v');
            await keytar.deletePassword(service, 't');
            process.exit(0);
        } catch (e) {
            process.exit(1);
        }
    `.replace(/\s+/g, ' ').trim();

    try {
        const result = spawnSync(process.execPath, [
            '--input-type=module',
            '--no-warnings',
            '-e',
            probeScript
        ], {
            stdio: 'ignore',
            timeout: 4000,
            windowsHide: true,
            env: { ...process.env, NODE_ENV: 'production' }
        });

        return !result.error && result.status === 0;
    } catch {
        return false;
    }
}

function createFallbackStore(errorMsg: string): StorageBackend {
    return {
        type: 'keytar',
        isAvailable: false,
        error: errorMsg,
        async saveKey(): Promise<boolean> { throw new Error(`Keytar unavailable: ${errorMsg}`); },
        async getKey() { return null; },
        async deleteKey() { return false; }
    };
}

export async function createKeytarStore(config: StorageConfig): Promise<StorageBackend> {
    if (!checkKeytarHealth()) {
        return createFallbackStore('Keytar health check failed (native module or system service unavailable)');
    }

    try {
        const keytarModule = await import('keytar') as any;
        const keytar = keytarModule.default || keytarModule;
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
        return createFallbackStore(error.message);
    }
}
