import { EthfsProtocol } from "../types/index.js";
export * from './log.js';
export * from './git-helper.js';
export declare function parseEthsURI(uri: string): Promise<EthfsProtocol>;
export declare function randomRPC(rpcs: string[]): string;
