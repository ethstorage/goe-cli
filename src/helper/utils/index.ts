import URLParse from "url-parse"
import pLimit from "p-limit";
import { ethers } from "ethers";

import { Networks, resolveRepoAddress, WalletManager } from "../../core/index.js"
import { GOEProtocol, NegotiationResult, PushRecord } from "../types/index.js";
import { getLocalCommitOids } from "./git-helper.js";
import { ContractDriver } from "../core/contract.js";

export * from './log.js';
export * from './git-helper.js';

function getOwner(): string {
    const address = WalletManager.getDefaultAddress();
    if (!address) throw new Error(`Wallet not found. Please run 'goe wallet create' to create it.`);
    return address;
}

export async function parseGoeURI(uri: string): Promise<GOEProtocol> {
    const url = new URLParse(uri);

    const chainId = Number(url.port);
    if (!chainId) throw new Error("invalid goe uri, no chainId");

    const netConfig = Networks[chainId];
    if (!netConfig) throw new Error(`Not Support chainId: ${chainId}`);

    const repoNamespace = url.hostname + url.pathname;
    const defaultOwner = getOwner();
    const repoAddress: string = await resolveRepoAddress(chainId, repoNamespace, defaultOwner);
    if (!repoAddress || !ethers.isAddress(repoAddress)) {
        throw new Error("invalid goe uri, no contract address");
    }

    return {
        remoteUrl: uri,
        repoAddress: repoAddress,
        chainId,
        netConfig,
    }
}

const DEFAULT_NEGOTIATION_RESULT: NegotiationResult = {
    commonRecord: null,
    commonIndex: -1,
    missingPacks: [],
    isFullHistory: false
};

async function getAllPushRecords(contractDriver: ContractDriver, refName: string, rpcLimit: number): Promise<PushRecord[]> {
    const allUpdates: PushRecord[] = [];

    const totalRecords = await contractDriver.getPushRecordsCount(refName);
    if (totalRecords === 0) {
        return [];
    }

    const limit = 150;
    const numPages = Math.ceil(totalRecords / limit);
    const requests: { start: number, limit: number }[] = [];
    for (let i = 0; i < numPages; i++) {
        const start = i * limit;
        requests.push({start, limit});
    }

    const concurrencyLimiter = pLimit(rpcLimit);
    const fetchTasks = requests.map(req => concurrencyLimiter(async () => {
        return contractDriver.getPushRecords(refName, req.start, req.limit);
    }));
    const allPagesUpdates = await Promise.all(fetchTasks);

    for (const updates of allPagesUpdates) {
        allUpdates.push(...updates);
    }
    return allUpdates;
}

export async function findCommonAncestor(
    contractDriver: ContractDriver,
    srcRef: string|null,
    dstRef: string,
    rpcLimit: number,
    gitdir: string
): Promise<NegotiationResult> {
    const totalRecords = await contractDriver.getPushRecordsCount(dstRef);
    if (totalRecords === 0) {
        return DEFAULT_NEGOTIATION_RESULT;
    }

    // get local all oid
    let localOids: Set<string>;
    if (srcRef) {
        localOids = await getLocalCommitOids(srcRef, gitdir);
        if (localOids.size === 0) {
            const allRecords = await getAllPushRecords(contractDriver, dstRef, rpcLimit);
            return {
                commonRecord: null,
                commonIndex: -1,
                missingPacks: allRecords,
                isFullHistory: true
            }
        }
    } else {
        const allRecords = await getAllPushRecords(contractDriver, dstRef, rpcLimit);
        return {
            commonRecord: null,
            commonIndex: -1,
            missingPacks: allRecords,
            isFullHistory: true
        }
    }


    // query contract
    const missingPacks: PushRecord[] = [];
    const limit = 150;

    let end = totalRecords;
    let foundCommon = false;
    while (end > 0) {
        let start = end - limit;
        start = start > 0 ? start : 0;
        const currentBlockRecords = await contractDriver.getPushRecords(dstRef, start, limit);

        let commonRecord: PushRecord | null = null;
        let commonIndex = -1;
        for (let i = currentBlockRecords.length - 1; i >= 0; i--) {
            const record = currentBlockRecords[i];
            if (localOids.has(record.newOid)) {
                // 1. find success！
                commonRecord = record;
                foundCommon = true;
                commonIndex = start + i;
                break;
            }

            missingPacks.push(record);
        }

        if (foundCommon) {
            return {
                commonRecord: commonRecord,
                commonIndex: commonIndex,
                missingPacks: missingPacks.reverse(),
                isFullHistory: false
            };
        }
        if (start === 0) {
            return {
                commonRecord: null,
                commonIndex: -1,
                missingPacks: missingPacks,
                isFullHistory: true
            };
        }

        end = start;
    }

    return DEFAULT_NEGOTIATION_RESULT;
}
