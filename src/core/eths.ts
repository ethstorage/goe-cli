import { ethers } from 'ethers';
import { FlatDirectory } from "ethstorage-sdk";
import { join } from "path";
import { mkdirSync, existsSync, writeFileSync } from "fs";

import { EthsProtocol, randomRPC } from "../utils/index.js";
import { ContractDriver } from "../storage/contract.js";
import { ETHSAbi } from "../config/abis.js";
import {Ref, EthsUpdate} from "../storage/types.js";
import {
    runCmdCapture,
    getLocalCommitOids,
    createPackFileBuffer,
    runGitIndexPackFromBuf
} from "../utils/git-helper.js";

import { log } from "../utils/log.js"
import { FetchRef, PushRef } from "../types/api-types.js";



// TODO
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, "../../.env");
dotenv.config({ path: envPath });

const privateKey = process.env.pk;

export function getPrivateKey(): string {
    // if (!wallet) wallet = "default"
    //
    // // Todo: 0xaddress find wallet
    // const keyPath = process.env.HOME + "/.git3/keys"
    // mkdirSync(keyPath, { recursive: true })
    //
    // const content = readFileSync(`${keyPath}/${wallet}`).toString()
    // const [walletType, key] = content.split("\n")
    //
    // let etherWallet =
    //     walletType === "privateKey" ? new ethers.Wallet(key) : ethers.Wallet.fromMnemonic(key)
    //
    // return etherWallet
    if (!privateKey) {
        throw new Error("pk is not defined in .env");
    }
    return privateKey;
}

class Eths {
    gitdir: string
    remoteUrl: string
    hubAddress: string
    chainId: number
    netConfig: Record<string, any>

    defaultBranch!: string;
    refs: Map<string, string> = new Map()

    contractDriver: ContractDriver

    constructor(gitdir: string, protocol: EthsProtocol, contractDriver: ContractDriver) {
        this.gitdir = gitdir
        this.remoteUrl = protocol.remoteUrl
        this.hubAddress = protocol.hubAddress
        this.chainId = protocol.chainId
        this.netConfig = protocol.netConfig
        this.contractDriver = contractDriver;

        this.refs = new Map()
    }

    static async create(gitdir: string, protocol: EthsProtocol): Promise<Eths> {
        const privateKey = getPrivateKey();

        const netConfig = protocol.netConfig;
        const rpcUrl = randomRPC(netConfig.rpc);
        const ethstorageRpc = randomRPC(netConfig.ethStorageRpc);

        const hubAddress = protocol.hubAddress
        const fd = await FlatDirectory.create({
            rpc: rpcUrl,
            ethStorageRpc: ethstorageRpc,
            privateKey,
            address: hubAddress
        })

        const wallet = new ethers.Wallet(privateKey);
        const contractDriver = new ContractDriver(rpcUrl, wallet, hubAddress, ETHSAbi, fd);
        return new Eths(gitdir, protocol, contractDriver);
    }

    async doList(forPush: boolean) {
        console.error("-----doList-----")
        const outLines: string[] = [];
        const refs = await this.getRefs();

        for (const ref of refs) {
            if (ref.ref === 'HEAD') {
                if (!forPush) outLines.push(`${ref.sha} HEAD\n`);
            } else {
                outLines.push(`${ref.sha} ${ref.ref}\n`);
            }
            this.refs.set(ref.ref, ref.sha);
        }

        return outLines.join('') + '\n';
    }

    async doFetch(refs: FetchRef[]) {
        console.error("-----doFetch-----", refs)

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

    async doPush(refs: PushRef[]): Promise<string> {
        console.error("-----doPush-----")
        let outLines: string[] = []
        let hasError = false
        for (let ref of refs) {
            const { src, dst, force = false } = ref;
            if (!dst.startsWith('refs/heads/')) {
                const err = `error: refusing to push to non-branch ref ${dst}`;
                outLines.push(err);
                hasError = true;
                continue;
            }

            if (!force) {
                // fast-forward push
                let out = await this.handlePush(ref.src, ref.dst)
                if (out.indexOf("error") >= 0) {hasError = true}
                outLines.push(out + "\n")
            } else {
                // force push or delete
                if (src === "") {
                    // delete
                    await this.handleBranchDeletion(dst, this.defaultBranch);
                    outLines.push(`- [deleted] ${dst}`);
                    this.refs.delete(dst);
                    continue;
                }

                // force push
                const out = await this.handleForcePush(src, dst);
                if (out.indexOf("error") >= 0) hasError = true
                outLines.push(out + "\n")
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
        if (defaultRef && defaultRef.sha !== "0000000000000000000000000000000000000000") {
            all.push({ ref: 'HEAD', sha: defaultRef.sha });
            this.defaultBranch = defaultRef.ref;
        }

        return all;
    }

    // fetch
    private async fetch(wantRef: string) {
        const updates = await this.getAllPushRecords(wantRef);
        if (updates.length === 0) {
            log(`Ref ${wantRef} has no history on remote.`);
            this.sendEmptyPackFileResponse();
            return;
        }

        //  pull
        const localOids = await getLocalCommitOids(wantRef);
        const missingPacks: EthsUpdate[] = [];
        let foundLocalHead = false;
        for (let i = updates.length - 1; i >= 0; i--) {
            const update = updates[i];
            if (localOids.has(update.newOid)) {
                foundLocalHead = true;
                break;
            }

            missingPacks.push(update);
        }
        if (missingPacks.length === 0 && foundLocalHead) {
            log(`No new objects to fetch for ${wantRef}.`);
            return this.sendEmptyPackFileResponse();
        }

        await this.sendPackfiles(missingPacks.reverse());
    }

    private async getAllPushRecords(refName: string): Promise<EthsUpdate[]> {
        const allUpdates: EthsUpdate[] = [];
        const limit = 150;
        let start = 0;
        while (true) {
            const updates = await this.contractDriver.getPushRecords(refName, start, limit);
            if (updates.length === 0) break;
            allUpdates.push(...updates);
            start += updates.length;
        }
        return allUpdates;
    }

    private sendEmptyPackFileResponse() {
        // 'PACK' + 2 (version) + 0 (object count) -> 4 + 4 + 4 = 12 bytes
        const emptyPack = Buffer.from('5041434b0000000200000000', 'hex');
        process.stdout.write(emptyPack);
    }

    private async sendPackfiles(updates: EthsUpdate[]) {
        const packDir = join(this.gitdir, "objects", "pack");
        if (!existsSync(packDir)) mkdirSync(packDir, { recursive: true });

        log(`Downloading ${updates.length} packfile(s) for branch.`);
        for (const update of updates) {
            const packKey = update.packfileKey;
            log(`progress downloading packfile ${packKey.slice(0, 10)}...`);

            const packData = await this.contractDriver.downloadPackFile(packKey);
            if (!packData) {
                throw new Error(`Failed to download packfile ${packKey}`);
            }

            await runGitIndexPackFromBuf(packData, this.gitdir);
        }

        const keepPath = join(packDir, `eths-helper-${Date.now()}.keep`);
        writeFileSync(keepPath, "keep\n");

        // finish
        process.stdout.write("\n");
    }

    // push
    private async handlePush(src: string, dst: string) {
        try {
            const hasPusherPerm = await this.contractDriver.hasPushPermission();
            if (!hasPusherPerm) {
                return `error ${dst} no permission`;
            }

            const newOid = (await runCmdCapture(["git", "rev-parse", src])).trim();
            const oldOid = this.refs.get(dst) || "";

            // 1. pack file
            const packFile = await createPackFileBuffer(newOid, oldOid);

            // 2. upload
            log('');
            log(`progress start pushing ${dst}`);
            let status = await this.contractDriver.uploadPack(dst, newOid, packFile);
            if (!status) {
                return `error ${dst} upload pack file fail`;
            }

            // 3. update
            status = await this.contractDriver.writeRef({
                refName: dst,
                oldOid: oldOid,
                newOid: newOid,
                size: packFile.length,
            });
            if (!status) {
                return `error ${dst} update refs fail`;
            }

            this.refs.set(dst, newOid);
            return `ok ${dst}`;
        } catch (err: any) {
            return `error ${dst} ${err.message}`;
        }
    }

    private async handleForcePush(src: string, dst: string) {
        try {
            const hasPusherPerm = await this.contractDriver.hasPushPermission();
            if (!hasPusherPerm) {
                return `error ${dst} no permission`;
            }

            const newOid = (await runCmdCapture(["git", "rev-parse", src])).trim();

            // 1. get all history
            const chainRecords = await this.getAllPushRecords(dst);
            const localOids = await getLocalCommitOids(src);

            // 2. find modify index
            let commonOid: string | null = null;
            let commonIndex = -1;
            for (let i = chainRecords.length - 1; i >= 0; i--) {
                const record = chainRecords[i];
                if (localOids.has(record.newOid)) {
                    commonOid = record.newOid;
                    commonIndex = i;
                    break;
                }
            }

            // 3. create pack file
            let packFile: Buffer;
            let parentOid: string;
            let parentIndex: number;
            if (commonOid) {
                packFile = await createPackFileBuffer(newOid, commonOid);
                parentOid = commonOid;
                parentIndex = commonIndex;
                log(`Force push: partial override (common ancestor: ${commonOid.slice(0, 7)})`);
            } else {
                packFile = await createPackFileBuffer(newOid);
                parentOid = "0x0000000000000000000000000000000000000000";
                parentIndex = 0;
                log(`Force push: full override (no common ancestor with remote)`);
            }


            // 4. upload pack file
            log('');
            log(`progress start pushing ${dst}`);
            let status = await this.contractDriver.uploadPack(dst, newOid, packFile);
            if (!status) {
                return `error ${dst} upload pack file fail`;
            }


            // 5. update refs
            status = await this.contractDriver.writeForceRef({
                refName: dst,
                oldOid: parentOid,
                newOid: newOid,
                size: packFile.length,
                parentIndex: parentIndex,
            });
            if (!status) {
                return `error ${dst} update refs fail`;
            }

            this.refs.set(dst, newOid);
            return `ok ${dst}`;
        } catch (err: any) {
            return `error ${dst} ${err.message}`;
        }
    }

    private async handleBranchDeletion(dst: string, defaultBranchRef: string) {
        if (dst === defaultBranchRef) {
            return `error: cannot delete default branch ${dst}`;
        }

        const hasForcePushPer = await this.contractDriver.hasForcePushPer(dst);
        if (!hasForcePushPer) {
            return "error: need maintainer role to delete branches";
        }

        await this.contractDriver.writeForceRef({
            refName: dst,
            oldOid: '0x0',
            newOid: '0x0',
            size: 0,
            parentIndex: 0,
        });
    }

    async close(): Promise<void> {
        await this.contractDriver.close();
    }
}

export default Eths
