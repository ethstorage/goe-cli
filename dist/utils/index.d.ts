export type EthsProtocol = {
    remoteUrl: string;
    hubAddress: string;
    chainId: number;
    netConfig: Record<string, any>;
    ns?: Record<string, any>;
    nsName?: string;
    nsDomain?: string;
};
export declare function parseEthsURI(uri: string): Promise<EthsProtocol>;
export declare function randomRPC(rpcs: string[]): string;
