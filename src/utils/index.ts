import URLParse from "url-parse"
import { ethers } from "ethers";

import { Networks } from "../config/index.js"
import { EthfsProtocol } from "../types/index.js";

export * from './log.js';
export * from './git-helper.js';

export async function parseEthsURI(uri: string): Promise<EthfsProtocol> {
    const url = new URLParse(uri)
    let hostname = url.hostname
    if (!hostname || !ethers.isAddress(hostname)) {
        throw new Error("invalid eths uri, no contract address")
    }

    let chainId = url.port ? parseInt(url.port) : null
    if (!chainId) throw new Error("invalid eths uri, no chainId")

    let netConfig = Networks[chainId]
    if (!netConfig) throw new Error(`Not Support chainId: ${chainId}`)

    return {
        remoteUrl: uri,
        hubAddress: hostname,
        chainId,
        netConfig,
    }
}

export function randomRPC(rpcs: string[]): string {
    return rpcs[Math.floor(Math.random() * rpcs.length)]
}
