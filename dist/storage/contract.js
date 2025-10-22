import { ethers } from 'ethers';
import { UploadType } from "ethstorage-sdk";
import { log } from "../utils/log.js";
const ZERO_ADDRESS_HEX = '0x0000000000000000000000000000000000000000';
const MAX_RPC_RETRIES = 3;
const RPC_RETRY_DELAY_MS = 1000;
async function withRetry(methodName, fn, isWrite = false) {
    for (let attempt = 1; attempt <= MAX_RPC_RETRIES; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            if (attempt === MAX_RPC_RETRIES) {
                log(`[ERROR] RPC call ${methodName} failed after ${MAX_RPC_RETRIES} attempts.`);
                throw error;
            }
            const errorType = isWrite ? 'Transaction' : 'Read';
            log(`[WARN] ${errorType} call ${methodName} failed (Attempt ${attempt}/${MAX_RPC_RETRIES}). Retrying in ${RPC_RETRY_DELAY_MS}ms. Error: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, RPC_RETRY_DELAY_MS));
        }
    }
    // Should be unreachable
    throw new Error(`Exceeded max retries for ${methodName}`);
}
export class ContractDriver {
    provider;
    signer;
    contract;
    flatDirectory;
    constructor(rpcUrl, signer, contractAddr, abi, flatDirectory) {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.signer = signer.connect(this.provider);
        this.contract = new ethers.Contract(contractAddr, abi, this.signer);
        this.flatDirectory = flatDirectory;
    }
    // --- Utility Methods ---
    toHex(oid) {
        if (!oid)
            return ZERO_ADDRESS_HEX;
        const cleanOid = oid.replace(/^0x/i, '');
        // Ensures 40-byte hash padding for safety
        return '0x' + cleanOid.padStart(40, '0');
    }
    fromHex(hash) {
        return hash.startsWith('0x') ? hash.slice(2) : hash;
    }
    // --- Read Operations (with Retry) ---
    async getDefaultBranch() {
        const [refBytes, shaHex] = await withRetry("getDefaultBranch", () => this.contract.getDefaultBranch());
        if (refBytes.length === 0) {
            return {
                ref: '',
                sha: this.fromHex(shaHex)
            };
        }
        return {
            ref: ethers.toUtf8String(refBytes),
            sha: this.fromHex(shaHex)
        };
    }
    async listBranches(start = 0, limit = 50) {
        const list = await withRetry("listBranches", () => this.contract.listBranches(start, limit));
        return list.map((item) => ({
            ref: ethers.toUtf8String(item.name),
            sha: this.fromHex(item.hash)
        }));
    }
    async hasPushPermission() {
        return await withRetry("canPush", () => this.contract.canPush(this.signer.address));
    }
    async hasForcePushPermission(refName) {
        const refNameBytes = ethers.toUtf8Bytes(refName);
        return await withRetry("canForcePush", () => this.contract.canForcePush(this.signer.address, refNameBytes));
    }
    async getPushRecords(refName, start, limit) {
        const refNameBytes = ethers.toUtf8Bytes(refName);
        const list = await withRetry("getPushRecords", () => this.contract.getPushRecords(refNameBytes, start, limit));
        return list.map((item) => ({
            newOid: this.fromHex(item.newOid),
            parentOid: this.fromHex(item.parentOid),
            packfileKey: this.fromHex(item.packfileKey),
            size: Number(item.size),
            timestamp: Number(item.timestamp),
            pusher: item.pusher
        }));
    }
    // --- Write Operations (with Retry) ---
    async writeRef(update) {
        const { refName, parentOid, newOid, size } = update;
        const refNameBytes = ethers.toUtf8Bytes(refName);
        const parentOidHex = this.toHex(parentOid);
        const newOidHex = this.toHex(newOid);
        const tx = await withRetry("push", async () => {
            return await this.contract.push(refNameBytes, parentOidHex, newOidHex, newOidHex, size);
        }, true);
        log(`[INFO] ${refName}: Sending push transaction, hash: ${tx.hash}`);
        const txRsp = await withRetry("push.wait", () => tx.wait(), true);
        const success = txRsp?.status === 1;
        if (!success) {
            log(`[ERROR] ${refName}: Transaction failed on chain (status ${txRsp?.status}).`);
        }
        return success;
    }
    async writeForceRef(update) {
        const { refName, parentOid, newOid, size } = update;
        const parentIndex = update.parentIndex ?? 0;
        const refNameBytes = ethers.toUtf8Bytes(refName);
        const parentOidHex = this.toHex(parentOid);
        const newOidHex = this.toHex(newOid);
        const tx = await withRetry("forcePush", async () => {
            return await this.contract.forcePush(refNameBytes, newOidHex, newOidHex, size, parentOidHex, parentIndex);
        }, true);
        log(`[INFO] ${refName}: Sending forcePush transaction, hash: ${tx.hash}`);
        const txRsp = await withRetry("forcePush.wait", () => tx.wait(), true);
        const success = txRsp?.status === 1;
        if (!success) {
            log(`[ERROR] ${refName}: Force push transaction failed on chain (status ${txRsp?.status}).`);
        }
        return success;
    }
    // --- FlatDirectory Operations (No RPC Retry - relies on FlatDirectory internal retry) ---
    async uploadPack(dst, fileKey, packFile) {
        let status = true;
        let currentSuccessIndex = -1;
        const uploadCallback = {
            onTransactionSent: (txHash, chunkIds) => {
                log(`[INFO] pack file ${dst}: Chunks ${chunkIds} Tx Hash: ${txHash}`);
            },
            onProgress: (progress, total, isChange) => {
                // Simplified logging logic for progress changes
                const completedIndices = [];
                for (let i = currentSuccessIndex + 1; i <= progress; i++) {
                    completedIndices.push(i);
                }
                if (completedIndices.length > 0) {
                    const action = isChange ? 'uploaded' : 'skipped (no change)';
                    log(`[PROGRESS] pack file ${dst}: Chunks ${completedIndices.join(',')} ${action}`);
                }
                currentSuccessIndex = progress;
            },
            onFail: (err) => {
                log(`[ERROR] pack file ${dst}: ${err.message}`);
                status = false;
            },
            onFinish: (totalChunks, totalSize, totalCost) => {
                log(`[INFO] pack file ${dst}: Finished ${totalChunks} chunks, ${totalSize} bytes. Total Cost: ${totalCost}`);
            }
        };
        const hashesMap = await this.flatDirectory.fetchHashes([fileKey]);
        const hashes = hashesMap[fileKey] || [];
        const request = {
            key: fileKey,
            content: packFile,
            chunkHashes: hashes,
            type: UploadType.Blob,
            callback: uploadCallback
        };
        // Rely on flatDirectory.upload's internal retry mechanism
        await this.flatDirectory.upload(request);
        return status;
    }
    async downloadPackFile(fileName) {
        const chunks = [];
        return new Promise((resolve, reject) => {
            let totalSize = 0;
            this.flatDirectory.download(fileName, {
                onProgress: (progress, count, chunk) => {
                    chunks.push(Buffer.from(chunk));
                    totalSize += chunk.length;
                    log(`[PROGRESS] Downloading packfile ${fileName.slice(0, 8)}... ${Math.round(progress * 100)}% (${totalSize} bytes)`);
                },
                onFail: (e) => {
                    log(`[ERROR] Packfile download failed for ${fileName}: ${e.message}`);
                    reject(new Error(`Download failed for packfile ${fileName}`));
                },
                onFinish: () => {
                    const fullBuffer = Buffer.concat(chunks);
                    log(`[INFO] Download finished for ${fileName}. Total size: ${fullBuffer.length} bytes.`);
                    resolve(fullBuffer);
                }
            });
        });
    }
    async close() {
        await this.flatDirectory.close();
    }
}
