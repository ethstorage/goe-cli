import { FetchRef, PushRef, EthfsProtocol } from "../types/index.js";
import { ContractDriver } from "./contract.js";
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
    constructor(gitdir: string, protocol: EthfsProtocol, contractDriver: ContractDriver);
    static create(gitdir: string, protocol: EthfsProtocol): Promise<Eths>;
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
