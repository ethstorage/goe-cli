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

  async getDefaultBranch(): Promise<{ref: string, sha: string}> {
    const [ref, sha] = await this.contract['getDefaultBranch']();
    if (ref.length === 0) {
      return {
        ref: '',
        sha: sha.startsWith('0x') ? sha.slice(2) : sha
      };
    }

    return {
      ref: ethers.toUtf8String(ref),
      sha: sha.startsWith("0x") ? sha.slice(2) : sha
    };
  }

  async listBranches(start = 0, limit = 50) {
    const list = await this.contract['listBranches'](start, limit);
    return list.map((item: any) => ({
      ref: ethers.toUtf8String(item.name),
      sha: item.hash.startsWith("0x") ? item.hash.slice(2) : item.hash
    }));
  }

  async hasPushPermission(): Promise<boolean> {
    return await this.contract['canPush'](this.signer.address);
  }

  async hasForcePushPermission(refName: string): Promise<boolean> {
    const refNameBytes = ethers.toUtf8Bytes(refName);
    return await this.contract['canForcePush'](this.signer.address, refNameBytes);
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
    let {refName, parentOid, newOid, size} = update;

    const refNameBytes = ethers.toUtf8Bytes(refName);
    if (parentOid === '' || parentOid === null || parentOid === undefined) {
      parentOid = '0x0000000000000000000000000000000000000000';
    } else if (!parentOid.startsWith('0x')) {
      parentOid = '0x' + parentOid;
    }
    if (newOid && !newOid.startsWith('0x')) {
      newOid = '0x' + newOid;
    }

    const tx = await this.contract['push'](refNameBytes, parentOid, newOid, newOid, size);
    log(`progress ${refName}: send commit data, hash: ${tx.hash}`);
    const txRsp = await tx.wait();
    return txRsp.status === 1;
  }

  async writeForceRef(update: Update) {
    let {refName, parentOid, newOid, size, parentIndex} = update;

    const refNameBytes = ethers.toUtf8Bytes(refName);
    if (parentOid === '' || parentOid === null || parentOid === undefined) {
      parentOid = '0x0000000000000000000000000000000000000000';
    } else if (!parentOid.startsWith('0x')) {
      parentOid = '0x' + parentOid;
    }
    if (newOid && !newOid.startsWith('0x')) {
      newOid = '0x' + newOid;
    }

    const tx = await this.contract['forcePush'](refNameBytes, newOid, newOid, size, parentOid, parentIndex);
    log(`progress ${refName}: send commit data, hash: ${tx.hash}`);
    const txRsp = await tx.wait();
    return txRsp.status === 1;
  }

  async getPushRecords(refName: string, start: number, limit: number) {
    const ref = ethers.hexlify(ethers.toUtf8Bytes(refName));
    const list = await this.contract['getPushRecords'](ref, start, limit);
    return list.map((item: any) => ({
      newOid: item.newOid.startsWith("0x") ? item.newOid.slice(2) : item.newOid,
      parentOid: item.parentOid.startsWith("0x") ? item.parentOid.slice(2) : item.parentOid,
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
