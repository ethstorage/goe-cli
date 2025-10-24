import { EthfsProtocol, NegotiationResult } from "../types/index.js";
import { ContractDriver } from "../core/contract.js";
export * from './log.js';
export * from './git-helper.js';
export declare function parseEthsURI(uri: string): Promise<EthfsProtocol>;
export declare function randomRPC(rpcs: string[]): string;
export declare function findCommonAncestor(contractDriver: ContractDriver, srcRef: string | null, dstRef: string, rpcLimit: number): Promise<NegotiationResult>;
