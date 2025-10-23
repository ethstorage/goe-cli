import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';
import { UploadType, FlatDirectory } from "ethstorage-sdk";
import { log } from "../utils/log.js"
import { Update, GitContract } from "./types.js";

const ZERO_ADDRESS_HEX = '0x0000000000000000000000000000000000000000';
const MAX_RPC_RETRIES = 3;
const RPC_RETRY_DELAY_MS = 1000;

async function withRetry<T>(
    methodName: string,
    fn: () => Promise<T>,
    isWrite: boolean = false
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RPC_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
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
  provider: ethers.JsonRpcProvider;
  signer: ethers.Wallet;
  contract: GitContract;
  flatDirectory: FlatDirectory;

  constructor(rpcUrl: string, signer: ethers.Wallet, contractAddr: string, abi: any, flatDirectory: FlatDirectory) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.signer = signer.connect(this.provider);
    this.contract = new ethers.Contract(contractAddr, abi, this.signer) as unknown as GitContract;
    this.flatDirectory = flatDirectory;
  }

  // --- Utility Methods ---
  private toHex(oid: string | null | undefined): string {
    if (!oid) return ZERO_ADDRESS_HEX;
    const cleanOid = oid.replace(/^0x/i, '');
    // Ensures 40-byte hash padding for safety
    return '0x' + cleanOid.padStart(40, '0');
  }

  private fromHex(hash: string): string {
    return hash.startsWith('0x') ? hash.slice(2) : hash;
  }

  // --- Read Operations (with Retry) ---
  async getDefaultBranch(): Promise<{ ref: string, sha: string }> {
    const [refBytes, shaHex] = await withRetry("getDefaultBranch",
        () => this.contract.getDefaultBranch()
    );

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
    const list = await withRetry("listBranches",
        () => this.contract.listBranches(start, limit)
    );

    return list.map((item: any) => ({
      ref: ethers.toUtf8String(item.name),
      sha: this.fromHex(item.hash)
    }));
  }

  async hasPushPermission(): Promise<boolean> {
    return await withRetry("canPush",
        () => this.contract.canPush(this.signer.address)
    );
  }

  async hasForcePushPermission(refName: string): Promise<boolean> {
    const refNameBytes = ethers.toUtf8Bytes(refName);
    return await withRetry("canForcePush",
        () => this.contract.canForcePush(this.signer.address, refNameBytes)
    );
  }

  async getPushRecords(refName: string, start: number, limit: number) {
    const refNameBytes = ethers.toUtf8Bytes(refName);
    const list = await withRetry("getPushRecords",
        () => this.contract.getPushRecords(refNameBytes, start, limit)
    );

    return list.map((item: any) => ({
      newOid: this.fromHex(item.newOid),
      parentOid: this.fromHex(item.parentOid),
      packfileKey: this.fromHex(item.packfileKey),
      size: Number(item.size),
      timestamp: Number(item.timestamp),
      pusher: item.pusher
    }));
  }

  async getPushRecordsCount(refName: string) {
    const refNameBytes = ethers.toUtf8Bytes(refName);
    const count = await withRetry("getPushRecordCount",
        () => this.contract.getPushRecordCount(refNameBytes)
    );
    return Number(count);
  }

  // --- Write Operations (with Retry) ---

  async writeRef(update: Update): Promise<boolean> {
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

  async writeForceRef(update: Update): Promise<boolean> {
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

  async uploadPack(dst: string, fileKey: string, packFile: Buffer): Promise<boolean> {
    let status = true;
    let currentSuccessIndex = -1;

    const uploadCallback = {
      onTransactionSent: (txHash: string, chunkIds: number[] | number) => {
        log(`[INFO] pack file ${dst}: Chunks ${chunkIds} Tx Hash: ${txHash}`);
      },
      onProgress: (progress: number, total: number, isChange: boolean) => {
        // Simplified logging logic for progress changes
        const completedIndices: number[] = [];
        for (let i = currentSuccessIndex + 1; i <= progress; i++) {
          completedIndices.push(i);
        }
        if (completedIndices.length > 0) {
          const action = isChange ? 'uploaded' : 'skipped (no change)';
          log(`[PROGRESS] pack file ${dst}: Chunks ${completedIndices.join(',')} ${action}`);
        }
        currentSuccessIndex = progress;
      },
      onFail: (err: Error) => {
        log(`[ERROR] pack file ${dst}: ${err.message}`);
        status = false;
      },
      onFinish: (totalChunks: number, totalSize: number, totalCost: bigint) => {
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

  async downloadPackFile(fileName: string, filePath: string): Promise<string> {
    await withRetry("downloadPackFile", async () => {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

      await new Promise<void>((resolve, reject) => {
        const writeStream = fs.createWriteStream(filePath);
        let totalSize = 0;
        const cleanup = (err?: Error) => {
          writeStream.destroy();
          if (err) {
            try { fs.unlinkSync(filePath); } catch {}
            reject(err);
          }
        };

        this.flatDirectory.download(fileName, {
          onProgress: (progress, count, chunk) => {
            totalSize += chunk.length;
            writeStream.write(chunk);
          },
          onFail: e => {
            cleanup(e);
          },
          onFinish: () => {
            log(`[INFO] Download finished for ${fileName}. Total size: ${totalSize} bytes.`);
            writeStream.end(() => resolve());
          }
        });

        writeStream.on('error', cleanup);
      });
    });

    return filePath;
  }

  async close() {
    await this.flatDirectory.close();
  }
}
