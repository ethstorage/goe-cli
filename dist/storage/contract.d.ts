import { ethers } from 'ethers';
import { FlatDirectory } from "ethstorage-sdk";
import { Update } from "./types.js";
export declare class ContractDriver {
    provider: ethers.JsonRpcProvider;
    signer: ethers.Wallet;
    contract: ethers.Contract;
    flatDirectory: FlatDirectory;
    constructor(rpcUrl: string, signer: ethers.Wallet, contractAddr: string, abi: any, flatDirectory: FlatDirectory);
    getDefaultBranch(): Promise<{
        ref: string;
        sha: string;
    }>;
    listBranches(start?: number, limit?: number): Promise<any>;
    hasPushPermission(): Promise<boolean>;
    hasForcePushPermission(refName: string): Promise<boolean>;
    uploadPack(dst: string, fileKey: string, packFile: Buffer): Promise<boolean>;
    writeRef(update: Update): Promise<boolean>;
    writeForceRef(update: Update): Promise<boolean>;
    getPushRecords(refName: string, start: number, limit: number): Promise<any>;
    downloadPackFile(fileName: string): Promise<Buffer<ArrayBufferLike>>;
    close(): Promise<void>;
}
