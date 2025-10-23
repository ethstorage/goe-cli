import { BaseContract, BigNumberish, BytesLike, ContractTransactionResponse, ethers } from "ethers";
export interface Update {
    refName: string;
    parentOid: string;
    newOid: string;
    size: number;
    parentIndex?: number;
}
export type Ref = {
    ref: string;
    sha: string;
};
interface BranchInfo {
    name: ethers.BytesLike;
    hash: string;
}
export interface PushRecord {
    newOid: string;
    parentOid: string;
    packfileKey: string;
    size: BigNumberish;
    timestamp: BigNumberish;
    pusher: string;
}
export interface GitContract extends BaseContract {
    getDefaultBranch(): Promise<[ethers.BytesLike, string]>;
    listBranches(start: BigNumberish, limit: BigNumberish): Promise<BranchInfo[]>;
    canPush(account: string): Promise<boolean>;
    canForcePush(account: string, refName: BytesLike): Promise<boolean>;
    getBranchHead(refName: BytesLike): Promise<[string, boolean]>;
    getPushRecords(refName: BytesLike, start: BigNumberish, limit: BigNumberish): Promise<PushRecord[]>;
    getPushRecordCount(refName: BytesLike): Promise<BigNumberish>;
    push(refName: BytesLike, parentOid: BytesLike, newOid: BytesLike, packfileKey: BytesLike, packfileSize: BigNumberish): Promise<ContractTransactionResponse>;
    forcePush(refName: BytesLike, newOid: BytesLike, packfileKey: BytesLike, packfileSize: BigNumberish, parentOid: BytesLike, parentIndex: BigNumberish): Promise<ContractTransactionResponse>;
}
export {};
