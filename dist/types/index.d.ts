import { PushRecord } from "./contract-types.js";
export * from './api-types.js';
export * from './contract-types.js';
export type EthfsProtocol = {
    remoteUrl: string;
    hubAddress: string;
    chainId: number;
    netConfig: Record<string, any>;
    ns?: Record<string, any>;
    nsName?: string;
    nsDomain?: string;
};
export interface NegotiationResult {
    commonRecord: PushRecord | null;
    commonIndex: number;
    missingPacks: PushRecord[];
    isFullHistory: boolean;
}
