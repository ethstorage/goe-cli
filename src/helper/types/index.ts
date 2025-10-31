import { PushRecord } from "./contract-types.js";

export * from './api-types.js';
export * from './contract-types.js';

export type EthsProtocol = {
    remoteUrl: string
    repoAddress: string
    chainId: number
    netConfig: Record<string, any>

    ns?: Record<string, any>
    nsName?: string
    nsDomain?: string
}

export interface NegotiationResult {
    commonRecord: PushRecord | null;
    commonIndex: number;
    missingPacks: PushRecord[];
    isFullHistory: boolean;
}

export interface PackFileChunk {
    path: string;
    size: number;
    startOid: string; // parent OID used as base for this pack
    endOid: string;   // last commit included in this pack
}

export interface PackCreationResult {
    chunks: PackFileChunk[];
    tempDir: string;
}
