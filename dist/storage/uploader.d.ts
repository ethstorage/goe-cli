export type UploadBlobResult = {
    nameInDB: string;
    chunkIds?: number[];
    sizes?: number[];
    totalSize: number;
    sha256: string;
};
export interface StorageDriver {
    uploadPackAsBlobs(packBuf: Uint8Array | Buffer, opts?: {
        chunkSize?: number;
    }): Promise<UploadBlobResult>;
    downloadPackByName?(nameInDB: string): Promise<Uint8Array | Buffer | null>;
}
export declare function uploadPackAsBlobsGeneric(driver: StorageDriver, packBuf: Buffer, opts?: {
    chunkSize?: number;
}): Promise<UploadBlobResult>;
