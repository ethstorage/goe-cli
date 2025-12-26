import pLimit from 'p-limit';
import fs from "fs/promises";
import { ethers } from 'ethers';
import { FlatDirectory } from "ethstorage-sdk";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

import {
    GOEProtocol, FetchRef, PackCreationResult,
    PushRecord, PushRef, Ref
} from "../types/index.js";
import { GOERepoAbi } from "../../core/config/index.js";
import {
    createCommitBoundaryPacks,
    findCommonAncestor,
    findMatchingLocalBranch,
    getOidFromRef,
    log,
    randomRPC,
    runGitPackFromFile
} from "../utils/index.js";
import { ContractDriver } from "./contract.js";

import { getWallet } from "../../core/wallet/index.js";

const ZERO_OID = "0000000000000000000000000000000000000000";
const RPC_CONCURRENCY_LIMIT = 8;
const DOWNLOAD_CONCURRENCY_LIMIT = 3;

class Goe {
    gitdir: string
    remoteUrl: string
    repoAddress: string
    chainId: number
    netConfig: Record<string, any>

    defaultBranch!: string;
    refs: Map<string, string> = new Map()

    contractDriver: ContractDriver

    constructor(gitdir: string, protocol: GOEProtocol, contractDriver: ContractDriver) {
        this.gitdir = gitdir
        this.remoteUrl = protocol.remoteUrl
        this.repoAddress = protocol.repoAddress
        this.chainId = protocol.chainId
        this.netConfig = protocol.netConfig
        this.contractDriver = contractDriver;

        this.refs = new Map()
    }

    static async create(gitdir: string, protocol: GOEProtocol): Promise<Goe> {
        const decryptedWallet = await getWallet();

        const netConfig = protocol.netConfig;
        const rpcUrl = randomRPC(netConfig.rpc);
        const ethstorageRpc = randomRPC(netConfig.ethStorageRpc);

        const repoAddress = protocol.repoAddress
        const fd = await FlatDirectory.create({
            rpc: rpcUrl,
            ethStorageRpc: ethstorageRpc,
            privateKey: decryptedWallet.privateKey,
            address: repoAddress
        });
        fd.setLogEnabled(false);

        const wallet = new ethers.Wallet(decryptedWallet.privateKey);
        const contractDriver = new ContractDriver(rpcUrl, wallet, repoAddress, GOERepoAbi, fd);
        return new Goe(gitdir, protocol, contractDriver);
    }

    async doList(forPush: boolean) {
        const outLines: string[] = [];
        const refs = await this.getRefs();

        for (const ref of refs) {
            if (ref.ref === 'HEAD') {
                // for-push mode usually does not output HEAD, because it is not possible to model to HEAD
                if (!forPush) outLines.push(`${ref.sha} HEAD\n`);
            } else {
                outLines.push(`${ref.sha} ${ref.ref}\n`);
            }
            this.refs.set(ref.ref, ref.sha);
        }

        return outLines.join('') + '\n';
    }

    async doFetch(refs: FetchRef[]) {
        const headRef = refs.find(item => item.ref === 'HEAD');
        const branchRefs = refs.filter(item => item.ref.startsWith('refs/heads/'));
        let finalBranchRefs: FetchRef[] = [...branchRefs];

        if (headRef) {
            const matchedBranch = branchRefs.find(branch => branch.oid === headRef.oid);
            if (!matchedBranch) {
                const defaultBranch = await this.contractDriver.getDefaultBranch();
                const defaultBranchRef = defaultBranch.ref;
                if (!finalBranchRefs.some(branch => branch.ref === defaultBranchRef)) {
                    finalBranchRefs.push({
                        oid: headRef.oid,
                        ref: defaultBranchRef
                    });
                }
            }
        }

        for (let ref of finalBranchRefs) {
            await this.fetch(ref.ref)
        }

        await this.close();

        return "\n\n"
    }

    async doPush(refs: PushRef[], gasIncPct: number): Promise<string> {
        let outLines: string[] = []

        for (let ref of refs) {
            const { src, dst, force = false } = ref;

            // internalResult：'ok <ref>' or 'error <ref> <reason>'
            let internalResult: string;
            if (!dst.startsWith('refs/heads/')) {
                // TODO support tag
                internalResult = `error ${dst} refusing to push to non-branch ref`;
            } else if (!force) {
                // fast-forward push
                internalResult = await this.handlePush(src, dst, gasIncPct)
            } else {
                // force push or delete
                if (src === "") {
                    // delete
                    internalResult = await this.handleBranchDeletion(dst, this.defaultBranch);
                } else {
                    // force push
                    internalResult = await this.handleForcePush(src, dst, gasIncPct);
                }
            }

            if (internalResult.startsWith("error")) {
                // error <ref> <reason>
                outLines.push(`${internalResult}\n`);
            } else if (internalResult.startsWith("ok")) {
                // ok <ref>
                outLines.push(`${internalResult}\n`);

                if (src !== "") {
                    const newOid = await getOidFromRef(src, this.gitdir);
                    this.refs.set(dst, newOid);
                } else {
                    this.refs.delete(dst);
                }
            } else {
                outLines.push(`error ${dst} internal helper error: unknown status\n`);
            }
        }

        await this.close();

        return outLines.join("") + "\n\n"
    }

    // list
    private async getRefs(): Promise<Ref[]> {
        // 1、all branch
        const pageSize = 150;
        let start = 0;
        let all: Ref[] = [];
        while (true) {
            const page = await this.contractDriver.listBranches(start, pageSize);
            if (page.length === 0) break;
            all.push(...page);
            start += page.length;
        }

        // 2. default branch
        const defaultRef = await this.contractDriver.getDefaultBranch();
        if (defaultRef && defaultRef.sha !== ZERO_OID) {
            all.push({ ref: 'HEAD', sha: defaultRef.sha });
            this.defaultBranch = defaultRef.ref;
        }

        return all;
    }

    // fetch
    private async fetch(wantRef: string) {
        log('[INFO] Starting negotiation with remote for missing packfiles...');
        const srcRef = await findMatchingLocalBranch(wantRef, this.gitdir);
        const result = await findCommonAncestor(
            this.contractDriver,
            srcRef, // 'refs/heads/main'
            wantRef, // 'refs/heads/master'
            RPC_CONCURRENCY_LIMIT,
            this.gitdir
        );

        const { missingPacks } = result;
        if (missingPacks.length === 0) {
            log(`No new objects to fetch for ${wantRef}.`);
            this.sendEmptyPackFileResponse();
            return;
        }

        await this.sendPackfiles(missingPacks);
    }

    private sendEmptyPackFileResponse() {
        // 'PACK' + 2 (version) + 0 (object count) -> 4 + 4 + 4 = 12 bytes
        const emptyPack = Buffer.from('5041434b0000000200000000', 'hex');
        process.stdout.write(emptyPack);
    }

    private async sendPackfiles(updates: PushRecord[]) {
        const packDir = join(this.gitdir, "objects", "pack");
        if (!existsSync(packDir)) mkdirSync(packDir, { recursive: true });

        // download
        log(`[INFO] Downloading ${updates.length} packfile(s) for branch...`);
        const limit = pLimit(DOWNLOAD_CONCURRENCY_LIMIT);
        const tasks = updates.map(update => limit(async () => {
            const packKey = update.packfileKey;
            const packFileName = `pack-${packKey}.pack`;
            const packFilePath = join(packDir, packFileName);
            await this.contractDriver.downloadPackFile(packKey, packFilePath);
            return packFilePath;
        }));
        const results = await Promise.allSettled(tasks);
        const success = results.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<string>[];
        const failed = results
            .filter(r => r.status === 'rejected') as PromiseRejectedResult[];
        if (failed.length > 0) {
            log(`[FATAL] ${failed.length} packfile(s) failed to download.`);
            for (const f of failed) log(`[ERROR] ${f.reason}`);

            // error finish
            process.exit(1);
            return;
        }

        // provided to git
        for (const { value: packFilePath } of success) {
            await runGitPackFromFile(packFilePath, this.gitdir);
        }
    }

    // push
    private async handlePush(src: string, dst: string, gasIncPct: number): Promise<string> {
        try {
            const hasPusherPerm = await this.contractDriver.hasPushPermission();
            if (!hasPusherPerm) {
                return `error ${dst} no push permission`;
            }

            const newOid = await getOidFromRef(src, this.gitdir);
            const parentOid = this.refs.get(dst) || null;

            // 1. pack file
            log('[INFO] Preparing Git packfiles, this may take a while...');
            let result: PackCreationResult;
            try {
                result = await createCommitBoundaryPacks(src, newOid, parentOid, this.gitdir);
            } catch (err: any) {
                return `error ${dst} create packfile fail`;
            }


            // 2. upload packfiles
            try {
                if (result.chunks.length === 0) {
                    log(`[INFO] No commits to push for ${dst}. Performing ref update only.`);
                } else {
                    log('');
                    log(`[PROGRESS] Starting upload of ${result.chunks.length} Packfiles to EthStorage for ref ${dst}...`);

                    for (const chunk of result.chunks) {
                        // 2.1 upload packfile
                        let status = await this.contractDriver.uploadPack(dst, chunk.endOid, chunk.path, gasIncPct);
                        if (!status) {
                            return `error ${dst} upload pack file fail`;
                        }

                        // 2.2 update ref
                        status = await this.contractDriver.writeRef({
                            refName: dst,
                            parentOid: chunk.startOid,
                            newOid: chunk.endOid,
                            size: chunk.size,
                        });
                        if (!status) {
                            return `error ${dst} update refs fail`;
                        }
                    }
                }
            } finally {
                if (result.tempDir) {
                    await fs.rm(result.tempDir, {recursive: true, force: true}).catch(err => {
                        log(`[WARNING] Failed to remove temp directory ${result.tempDir}: ${err}`);
                    });
                }
            }

            return `ok ${dst}`;
        } catch (err: any) {
            log(`[ERROR] handle push ${dst}: ${this.formatErrorForLog(err)}`);
            return `error ${dst} handle push fail`;
        }
    }

    private async handleForcePush(src: string, dst: string, gasIncPct: number): Promise<string> {
        try {
            const hasPusherPerm = await this.contractDriver.hasForcePushPermission(dst);
            if (!hasPusherPerm) {
                return `error ${dst} no force push permission`;
            }

            //  1. find parent oid
            const newOid = await getOidFromRef(src, this.gitdir);
            const result = await findCommonAncestor(
                this.contractDriver,
                src,
                dst,
                RPC_CONCURRENCY_LIMIT,
                this.gitdir
            );

            const commonRecord = result.commonRecord;
            const commonIndex = result.commonIndex;

            // 2. create packfile
            log('[INFO] Preparing Git packfiles, this may take a while...');
            let packFileResult: PackCreationResult;
            let parentIndex: number;
            try {
                if (commonRecord) {
                    const commonOid = commonRecord.newOid;
                    packFileResult = await createCommitBoundaryPacks(src, newOid, commonOid, this.gitdir);
                    parentIndex = commonIndex;
                    log(`[INFO] Force push: Partial override (Ancestor: ${commonOid}, Index: ${parentIndex})`);
                } else {
                    packFileResult = await createCommitBoundaryPacks(src, newOid, null, this.gitdir);
                    parentIndex = 0;
                    log(`[INFO] Force push: Full override (No common ancestor).`);
                }
            } catch (err: any) {
                return `error ${dst} create packfile fail`;
            }

            // 3. upload Pack file
            log('');
            try {
                if (packFileResult.chunks.length === 0) {
                    log(`[INFO] No commits to push for ${dst}. Performing ref update only.`);
                } else {
                    log('');
                    log(`[PROGRESS] Starting upload of ${packFileResult.chunks.length} Packfiles to EthStorage for ref ${dst}...`);

                    for (const chunk of packFileResult.chunks) {
                        // 3.1 upload packfile
                        let status = await this.contractDriver.uploadPack(dst, chunk.endOid, chunk.path, gasIncPct);
                        if (!status) {
                            return `error ${dst} upload pack file fail`;
                        }

                        // 3.2 update ref
                        if (parentIndex !== -1) {
                            status = await this.contractDriver.writeForceRef({
                                refName: dst,
                                parentOid: chunk.startOid || ZERO_OID,
                                newOid: chunk.endOid,
                                size: chunk.size,
                                parentIndex: parentIndex,
                            });
                            parentIndex = -1;
                        } else {
                            status = await this.contractDriver.writeRef({
                                refName: dst,
                                parentOid: chunk.startOid,
                                newOid: chunk.endOid,
                                size: chunk.size,
                            });
                        }
                        if (!status) {
                            return `error ${dst} update refs fail`;
                        }
                    }
                }
            } finally {
                if (packFileResult.tempDir) {
                    await fs.rm(packFileResult.tempDir, {recursive: true, force: true}).catch(err => {
                        log(`[WARNING] Failed to remove temp directory ${packFileResult.tempDir}: ${err}`);
                    });
                }
            }

            return `ok ${dst}`;
        } catch (err: any) {
            log(`[ERROR] handle force push ${dst}: ${this.formatErrorForLog(err)}`);
            return `error ${dst} handle force push fail`;
        }
    }

    private async handleBranchDeletion(dst: string, defaultBranchRef: string): Promise<string> {
        if (dst === defaultBranchRef) {
            return `error ${dst} cannot delete default branch`;
        }

        try {
            const hasForcePushPer = await this.contractDriver.hasForcePushPermission(dst);
            if (!hasForcePushPer) {
                return `error ${dst} no permission to delete branch`;
            }

            const ok = await this.contractDriver.writeForceRef({
                refName: dst,
                parentOid: ZERO_OID,
                newOid: ZERO_OID,
                size: 0,
                parentIndex: 0,
            });
            if (!ok) {
                return `error ${dst} deleted refs fail`;
            }

            return `ok ${dst}`;
        } catch (err: any) {
            log(`[ERROR] handle branch deletion ${dst}: ${this.formatErrorForLog(err)}`);
            return `error ${dst} handle branch deletion fail`;
        }
    }

    private formatErrorForLog(err: unknown, maxLen = 1400): string {
        let msg: string;
        if (err instanceof Error) {
            msg = err.stack || err.message;
        } else {
            msg = String(err);
        }
        msg = msg.replace(/\s+/g, ' ').trim();
        if (msg.length <= maxLen) {
            return msg;
        }

        const len = Math.floor(maxLen * 0.4);
        return (
            msg.slice(0, len) +
            ' ... ' +
            msg.slice(msg.length - len)
        );
    }

    async close(): Promise<void> {
        await this.contractDriver.close();
    }
}

export default Goe
