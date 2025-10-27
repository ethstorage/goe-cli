import {BaseContract, BigNumberish, BytesLike, ContractTransactionResponse, ethers} from "ethers";

export interface Update {
    refName: string;        // bytes32
    parentOid: string;         // bytes20
    newOid: string;         // bytes20
    size: number;           // uint256
    parentIndex?: number;
}

export type Ref = {
    ref: string
    sha: string
}

interface BranchInfo {
    name: ethers.BytesLike; // bytes
    hash: string;           // bytes20 (as string)
}

export interface PushRecord {
    newOid: string;         // bytes20
    parentOid: string;      // bytes20
    packfileKey: string;    // bytes20
    size: BigNumberish;     // uint256
    timestamp: BigNumberish;// uint256
    pusher: string;         // address
}

export interface GitContract extends BaseContract {
    // Read Methods (View)
    getDefaultBranch(): Promise<[ethers.BytesLike, string]>; // bytes, bytes20
    listBranches(start: BigNumberish, limit: BigNumberish): Promise<BranchInfo[]>;

    canPush(account: string): Promise<boolean>;

    canForcePush(account: string, refName: BytesLike): Promise<boolean>;

    getBranchHead(refName: BytesLike): Promise<[string, boolean]>; // bytes20 headOid, bool exists
    getPushRecords(refName: BytesLike, start: BigNumberish, limit: BigNumberish): Promise<PushRecord[]>;

    getPushRecordCount(refName: BytesLike): Promise<BigNumberish>;

    // Write Methods (State-changing) - 返回 Promise<ContractTransactionResponse>
    push(
        refName: BytesLike,
        parentOid: BytesLike,
        newOid: BytesLike,
        packfileKey: BytesLike,
        packfileSize: BigNumberish
    ): Promise<ContractTransactionResponse>;

    forcePush(
        refName: BytesLike,
        newOid: BytesLike,
        packfileKey: BytesLike,
        packfileSize: BigNumberish,
        parentOid: BytesLike,
        parentIndex: BigNumberish
    ): Promise<ContractTransactionResponse>;
}
