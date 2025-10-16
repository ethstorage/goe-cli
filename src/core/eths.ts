import { ethers } from 'ethers';
import { FlatDirectory } from "ethstorage-sdk";
import { join } from "path";
import { mkdirSync, existsSync, writeFileSync } from "fs";

import { EthsProtocol, randomRPC } from "../utils/index.js";
import { ContractDriver } from "../storage/contract.js";
import { ETHSAbi } from "../config/abis.js";
import { Ref, EthsUpdate } from "../storage/types.js";
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

    refs: Map<string, string> = new Map()
    pushed: Map<string, string> = new Map()

    contractDriver: ContractDriver

    constructor(gitdir: string, protocol: EthsProtocol, contractDriver: ContractDriver) {
        this.gitdir = gitdir
        this.remoteUrl = protocol.remoteUrl
        this.hubAddress = protocol.hubAddress
        this.chainId = protocol.chainId
        this.netConfig = protocol.netConfig
        this.contractDriver = contractDriver;

        this.refs = new Map()
        this.pushed = new Map()
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
            if (matchedBranch) {
                //  remove HEAD branch
            } else {
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
        // let remoteHead = null
        let hasError = false
        for (let ref of refs) {
            // TODO permissio check
            // if (!(await this.storage.hasPermission(ref.dst))) {
            //     return (
            //         `error ${ref.dst} refusing to push to remote ${this.remoteUrl} (permission denied)` +
            //         "\n\n"
            //     )
            // }

            if (ref.src == "") {
                // TODO remove branch
                // if (this.refs.get("HEAD") == ref.dst) {
                //     return (
                //         `error ${ref.dst} refusing to delete the current branch: ${ref.dst}` +
                //         "\n\n"
                //     )
                // }
                // log(`deleting ref: ${ref.dst}\n`);
                // this.storage.removeRef(ref.dst)
                // this.refs.delete(ref.dst)
                // this.pushed.delete(ref.dst)
            } else {
                let out = await this.pushPackFile(ref.src, ref.dst)
                if (out.indexOf("error") >= 0) hasError = true
                outLines.push(out + "\n")
            }
        }

        // TODO default branch
        // if (this.refs.size == 0 && !hasError) {
        //     // first push
        //     let symbolicRef = GitUtils.symbolicRef("HEAD")
        //     let err = await this.wirteRef(symbolicRef, "HEAD", true)
        //     if (err) {
        //         return `error HEAD ${err}`
        //     }
        // }

        await this.close();

        return outLines.join("") + "\n\n"
    }

    async fetch(wantRef: string) {
        const updates = await this.getAllBranchUpdates(wantRef);
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
            if (localOids.includes(update.newOid)) {
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

    private async getAllBranchUpdates(refName: string): Promise<EthsUpdate[]> {
        const allUpdates: EthsUpdate[] = [];
        const limit = 150;
        let start = 0;
        while (true) {
            const updates = await this.contractDriver.getBranchUpdates(refName, start, limit);
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

    async pushPackFile(src: string, dst: string) {
        try {
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

    async getRefs(): Promise<Ref[]> {
        // 1、all branch
        const pageSize = 50;
        let start = 0;
        let all: Ref[] = [];
        while (true) {
            const page = await this.contractDriver.listRefsPaginated(start, pageSize);
            if (page.length === 0) break;
            all.push(...page);
            start += page.length;
        }

        // 2. default branch
        const defaultRef = await this.contractDriver.getDefaultBranch();
        if (defaultRef && defaultRef.sha !== "0000000000000000000000000000000000000000") {
            all.push({ ref: 'HEAD', sha: defaultRef.sha });
        }
        return all;
    }

    async close(): Promise<void> {
        await this.contractDriver.close();
    }
}

export default Eths
