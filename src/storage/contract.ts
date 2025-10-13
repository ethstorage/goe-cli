import { ethers } from 'ethers';
import { UploadType, FlatDirectory } from "ethstorage-sdk";
import { NodeFile } from "ethstorage-sdk/file"
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

  async uploadPack(dst: string, fileKey: string, filePath: string): Promise<boolean> {
    let status = true;
    let currentSuccessIndex = -1;
    const uploadCallback = {
      onProgress: (progress: number, total: number, isChange: boolean) => {
        const indexArr: number[] = [];
        for (let i = currentSuccessIndex + 1; i <= progress; i++) {
          indexArr.push(i);
        }
        if (isChange) {
          log(`progress ${dst}: Chunks ${indexArr.join(',')} uploaded`);
        } else {
          log(`progress ${dst}: Chunks ${indexArr.join(',')} skipped (no change)`);
        }
        currentSuccessIndex = progress;
      },
      onFail: (err: Error) => {
        console.error(`error: ${dst}: ${err.message}`);
        status = false;
      },
      onFinish: (totalChunks: number, totalSize: number, totalCost: bigint) => {
        log(`progress ${dst}: Finished ${totalChunks} chunks, ${totalSize} bytes`);
      }
    };

    const hashesMap = await this.flatDirectory.fetchHashes([fileKey]);
    const hashes = hashesMap[fileKey];
    const file = new NodeFile(filePath);
    const request = {
      key: fileKey,
      content: file,
      chunkHashes: hashes,
      type: UploadType.Blob,
      callback: uploadCallback
    }

    await this.flatDirectory.upload(request);
    return status;
  }

  async writeRef(dst: string, update: Update) {
    const refNameBytes = ethers.toUtf8Bytes(dst);
    const tx = await this.contract['pushUpdate'](refNameBytes, {
      refName: update.refName,
      oldOid: update.oldOid,
      newOid: update.newOid,
      size: update.size,
    });

    log(`progress ${dst}: send commit data`);
    const txRsp = await tx.wait();
    return txRsp.status === 1;
  }
}
