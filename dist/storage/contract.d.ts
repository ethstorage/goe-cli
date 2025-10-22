import { ethers } from 'ethers';
import { FlatDirectory } from "ethstorage-sdk";
import { Update, GitContract } from "./types.js";
export declare class ContractDriver {
    provider: ethers.JsonRpcProvider;
    signer: ethers.Wallet;
    contract: GitContract;
    flatDirectory: FlatDirectory;
    constructor(rpcUrl: string, signer: ethers.Wallet, contractAddr: string, abi: any, flatDirectory: FlatDirectory);
    private toHex;
    private fromHex;
    getDefaultBranch(): Promise<{
        ref: string;
        sha: string;
    }>;
    listBranches(start?: number, limit?: number): Promise<{
        ref: string;
        sha: string;
    }[]>;
    hasPushPermission(): Promise<boolean>;
    hasForcePushPermission(refName: string): Promise<boolean>;
    getPushRecords(refName: string, start: number, limit: number): Promise<{
        newOid: string;
        parentOid: string;
        packfileKey: string;
        size: number;
        timestamp: number;
        pusher: any;
    }[]>;
    writeRef(update: Update): Promise<boolean>;
    writeForceRef(update: Update): Promise<boolean>;
    uploadPack(dst: string, fileKey: string, packFile: Buffer): Promise<boolean>;
    downloadPackFile(fileName: string): Promise<Buffer>;
    close(): Promise<void>;
}
