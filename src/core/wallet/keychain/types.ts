
export interface StoreEntry {
    key: string;
    lastUsedAt: string;
}


export interface StorageBackend {
    type: 'keytar' | 'file';
    isAvailable: boolean;

    saveKey(address: string, key: string): Promise<boolean>;
    getKey(address: string): Promise<string | null>;
    deleteKey(address: string): Promise<boolean>;
    error?: string;
}

export interface StorageConfig {
    defaultIdleTimeoutHours: number;
    serviceName: string;
    storePath?: string;
}
