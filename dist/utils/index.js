import URLParse from "url-parse";
import pLimit from "p-limit";
import { ethers } from "ethers";
import { Networks } from "../config/index.js";
import { getLocalCommitOids } from "./git-helper.js";
export * from './log.js';
export * from './git-helper.js';
export async function parseEthsURI(uri) {
    const url = new URLParse(uri);
    let hostname = url.hostname;
    if (!hostname || !ethers.isAddress(hostname)) {
        throw new Error("invalid eths uri, no contract address");
    }
    let chainId = url.port ? parseInt(url.port) : null;
    if (!chainId)
        throw new Error("invalid eths uri, no chainId");
    let netConfig = Networks[chainId];
    if (!netConfig)
        throw new Error(`Not Support chainId: ${chainId}`);
    return {
        remoteUrl: uri,
        hubAddress: hostname,
        chainId,
        netConfig,
    };
}
export function randomRPC(rpcs) {
    return rpcs[Math.floor(Math.random() * rpcs.length)];
}
const DEFAULT_NEGOTIATION_RESULT = {
    commonRecord: null,
    commonIndex: -1,
    missingPacks: [],
    isFullHistory: false
};
async function getAllPushRecords(contractDriver, refName, rpcLimit) {
    const allUpdates = [];
    const totalRecords = await contractDriver.getPushRecordsCount(refName);
    if (totalRecords === 0) {
        return [];
    }
    const limit = 150;
    const numPages = Math.ceil(totalRecords / limit);
    const requests = [];
    for (let i = 0; i < numPages; i++) {
        const start = i * limit;
        requests.push({ start, limit });
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
export async function findCommonAncestor(contractDriver, srcRef, dstRef, rpcLimit) {
    const totalRecords = await contractDriver.getPushRecordsCount(dstRef);
    if (totalRecords === 0) {
        return DEFAULT_NEGOTIATION_RESULT;
    }
    // get local all oid
    let localOids;
    if (srcRef) {
        localOids = await getLocalCommitOids(srcRef);
        if (localOids.size === 0) {
            const allRecords = await getAllPushRecords(contractDriver, dstRef, rpcLimit);
            return {
                commonRecord: null,
                commonIndex: -1,
                missingPacks: allRecords,
                isFullHistory: true
            };
        }
    }
    else {
        const allRecords = await getAllPushRecords(contractDriver, dstRef, rpcLimit);
        return {
            commonRecord: null,
            commonIndex: -1,
            missingPacks: allRecords,
            isFullHistory: true
        };
    }
    // query contract
    const missingPacks = [];
    const limit = 150;
    let end = totalRecords;
    let foundCommon = false;
    while (end > 0) {
        let start = end - limit;
        start = start > 0 ? start : 0;
        const currentBlockRecords = await contractDriver.getPushRecords(dstRef, start, limit);
        let commonRecord = null;
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
