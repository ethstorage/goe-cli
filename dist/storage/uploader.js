import crypto from 'crypto';
// A small generic uploader wrapper that splits a pack and delegates to a StorageDriver.
// This is a stub implementation; you must implement the driver (eg. using ethstorage-sdk).
export async function uploadPackAsBlobsGeneric(driver, packBuf, opts) {
    const chunkSize = opts?.chunkSize ?? 1024 * 1024;
    const chunks = [];
    for (let i = 0; i < packBuf.length; i += chunkSize) {
        chunks.push(packBuf.slice(i, i + chunkSize));
    }
    // If driver implements atomic batch, prefer that.
    // Here we just pass the whole pack to driver and let it split.
    const sha256 = crypto.createHash('sha256').update(packBuf).digest('hex');
    const res = await driver.uploadPackAsBlobs(packBuf, { chunkSize });
    // ensure basic metadata present
    return {
        nameInDB: res.nameInDB,
        chunkIds: res.chunkIds || [],
        sizes: res.sizes || [],
        totalSize: packBuf.length,
        sha256
    };
}
