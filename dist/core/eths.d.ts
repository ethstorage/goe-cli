import { EthsProtocol } from "../utils/index.js";
import { ContractDriver } from "../storage/contract.js";
import { FetchRef, PushRef } from "../types/api-types.js";
export declare function getPrivateKey(): string;
declare class Eths {
    gitdir: string;
    remoteUrl: string;
    hubAddress: string;
    chainId: number;
    netConfig: Record<string, any>;
    defaultBranch: string;
    refs: Map<string, string>;
    contractDriver: ContractDriver;
    constructor(gitdir: string, protocol: EthsProtocol, contractDriver: ContractDriver);
    static create(gitdir: string, protocol: EthsProtocol): Promise<Eths>;
    doList(forPush: boolean): Promise<string>;
    doFetch(refs: FetchRef[]): Promise<string>;
    doPush(refs: PushRef[]): Promise<string>;
    private getRefs;
    private fetch;
    private getAllPushRecords;
    private sendEmptyPackFileResponse;
    private sendPackfiles;
    private handlePush;
    private handleForcePush;
    private handleBranchDeletion;
    close(): Promise<void>;
}
export default Eths;
