import { ethers } from 'ethers';
import { UploadType, FlatDirectory } from "ethstorage-sdk";
import { log } from "../utils/log.js"
import { Update } from "./types.js";

export class ContractDriver {
  provider: ethers.JsonRpcProvider;
  signer: ethers.Wallet;
  contract: ethers.Contract;
  flatDirectory: FlatDirectory;

  constructor(rpcUrl: string, signer: ethers.Wallet, contractAddr: string, abi: any, flatDirectory: FlatDirectory) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.signer = signer.connect(this.provider);
    this.contract = new ethers.Contract(contractAddr, abi, this.signer);
    this.flatDirectory = flatDirectory;
  }

  async getDefaultBranch(): Promise<string> {
    let defaultBranchHash = await this.contract['getDefaultBranch']();
    defaultBranchHash = defaultBranchHash.startsWith('0x') ? defaultBranchHash.slice(2) : defaultBranchHash
    return defaultBranchHash;
  }

  async listRefsPaginated(start = 0, limit = 50) {
    const list = await this.contract['listBranchesPaginated'](start, limit);
    return list.map((item: any) => ({
      ref: ethers.toUtf8String(item.name),
      sha: item.hash.startsWith("0x") ? item.hash.slice(2) : item.hash
    }));
  }

  async uploadPack(dst: string, fileKey: string, packFile: Buffer): Promise<boolean> {
    let status = true;
    let currentSuccessIndex = -1;
    const uploadCallback = {
      onProgress: (progress: number, total: number, isChange: boolean) => {
        const indexArr: number[] = [];
        for (let i = currentSuccessIndex + 1; i <= progress; i++) {
          indexArr.push(i);
        }
        if (isChange) {
          log(`progress pack file ${dst}: Chunks ${indexArr.join(',')} uploaded`);
        } else {
          log(`progress pack file ${dst}: Chunks ${indexArr.join(',')} skipped (no change)`);
        }
        currentSuccessIndex = progress;
      },
      onFail: (err: Error) => {
        log(`error pack file: ${dst}: ${err.message}`);
        status = false;
      },
      onFinish: (totalChunks: number, totalSize: number, totalCost: bigint) => {
        log(`progress pack file ${dst}: Finished ${totalChunks} chunks, ${totalSize} bytes`);
      }
    };

    const hashesMap = await this.flatDirectory.fetchHashes([fileKey]);
    const hashes = hashesMap[fileKey];
    const request = {
      key: fileKey,
      content: packFile,
      chunkHashes: hashes,
      type: UploadType.Blob,
      callback: uploadCallback
    }

    await this.flatDirectory.upload(request);
    return status;
  }

  async writeRef(update: Update) {
    let {refName, oldOid, newOid, size} = update;

    const refNameBytes = ethers.toUtf8Bytes(refName);
    if (oldOid === '' || oldOid === null || oldOid === undefined) {
      oldOid = '0x0000000000000000000000000000000000000000';
    } else if (!oldOid.startsWith('0x')) {
      oldOid = '0x' + oldOid;
    }
    if (newOid && !newOid.startsWith('0x')) {
      newOid = '0x' + newOid;
    }

    const tx = await this.contract['pushUpdate'](refNameBytes, oldOid, newOid, size);
    log(`progress ${refName}: send commit data, hash: ${tx.hash}`);
    const txRsp = await tx.wait();
    return txRsp.status === 1;
  }

  async getBranchUpdates(refName: string, start: number, limit: number) {
    const ref = ethers.hexlify(ethers.toUtf8Bytes(refName));
    const list = await this.contract['getBranchUpdates'](ref, start, limit);
    return list.map((item: any) => ({
      refName: ethers.toUtf8String(item.refName),
      oldOid: item.oldOid.startsWith("0x") ? item.oldOid.slice(2) : item.oldOid,
      newOid: item.newOid.startsWith("0x") ? item.newOid.slice(2) : item.newOid,
      packfileKey: item.packfileKey.startsWith("0x") ? item.packfileKey.slice(2) : item.packfileKey,
      size: Number(item.size),
      timestamp: Number(item.timestamp),
      pusher: item.pusher
    }));
  }

  async downloadPackFile(fileName: string) {
    const chunks: Buffer[] = [];
    return new Promise<Buffer>((resolve, reject) => {
      let totalSize = 0;
      this.flatDirectory.download(fileName, {
        onProgress: (progress, count, chunk) => {
          chunks.push(Buffer.from(chunk));
          totalSize += chunk.length;
          log(`progress Downloading packfile ${fileName.slice(0, 8)}... ${Math.round(progress * 100)}% (${totalSize} bytes)`);
        },
        onFail: (e) => {
          log(`error: Packfile download failed for ${fileName}: ${e.message}`);
          reject(new Error(`Download failed for packfile ${fileName}`));
        },
        onFinish: () => {
          const fullBuffer = Buffer.concat(chunks);
          log(`progress Download finished for ${fileName}. Total size: ${fullBuffer.length} bytes.`);
          resolve(fullBuffer);
        }
      });
    });
  }

  async close() {
    await this.flatDirectory.close();
  }
}
