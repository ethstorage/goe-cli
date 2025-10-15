import { ethers } from 'ethers';
import { FlatDirectory } from "ethstorage-sdk";
import { EthsProtocol, randomRPC } from "../utils/index.js";
import { ContractDriver } from "../storage/contract.js";
import { ETHSAbi } from "../config/abis.js";
import { Ref, EthsUpdate } from "../storage/types.js";
import { runCmdCapture, getLocalCommitOids, createPackFileBuffer } from "../utils/git-helper.js";

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
    remoteUrl: string
    hubAddress: string
    chainId: number
    netConfig: Record<string, any>

    refs: Map<string, string> = new Map()
    pushed: Map<string, string> = new Map()

    contractDriver: ContractDriver

    constructor(protocol: EthsProtocol, contractDriver: ContractDriver) {
        this.remoteUrl = protocol.remoteUrl
        this.hubAddress = protocol.hubAddress
        this.chainId = protocol.chainId
        this.netConfig = protocol.netConfig
        this.contractDriver = contractDriver;

        this.refs = new Map()
        this.pushed = new Map()
    }

    static async create(protocol: EthsProtocol): Promise<Eths> {
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
        return new Eths(protocol, contractDriver);
    }

    async doList(forPush: boolean) {
        console.error("-----doList-----")
        const outLines: string[] = [];
        const refs = await this.getRefs();

        for (const ref of refs) {
            if (ref.ref === 'HEAD') {
                if (!forPush) outLines.push(`@${ref.sha} HEAD\n`);
            } else {
                outLines.push(`${ref.sha} ${ref.ref}\n`);
            }
            this.refs.set(ref.ref, ref.sha);
        }

        return outLines.join('') + '\n';
    }

    async doFetch(refs: FetchRef[]) {
        console.error("-----doFetch-----", refs)

        let negotiationRefs: FetchRef[] = [];
        // clone
        const cloneFetch = this.getCloneFetch(refs);
        if (cloneFetch) {
            const {cloneRef, masterRef} = cloneFetch;
            negotiationRefs = refs.filter(r =>
                r !== cloneRef &&
                r !== masterRef
            );
            // add new
            negotiationRefs.push({
                oid: cloneRef.oid,
                ref: masterRef.ref
            });
        } else {
            negotiationRefs = refs.filter(r => r.ref.startsWith('refs/'));
        }

        for (let ref of negotiationRefs) {
            await this.fetch(ref.oid, ref.ref)
        }
        log(`done.`);
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

        return outLines.join("") + "\n\n"
    }

    getCloneFetch(refs: FetchRef[]) {
        // fetch 0000000000000000000000000000000000000000 1b18fb0d2ded193ad2442b7a29a9738f11a5afed
        const cloneRef = refs.find(
            r => r.oid === '0000000000000000000000000000000000000000' && r.ref.length === 40
        );
        if (cloneRef) {
            // fetch 1b18fb0d2ded193ad2442b7a29a9738f11a5afed refs/heads/master
            const masterRef = refs.find(r => r.oid === cloneRef.ref);
            if (masterRef) {
                return {
                    cloneRef,
                    masterRef
                };
            } else {
                throw new Error("Clone initiated but target ref name not found.");
            }
        }
        return null;
    }

    async fetch(haveOid: string, wantRef: string) {
        const updates = await this.getAllBranchUpdates(wantRef);
        if (updates.length === 0) {
            log(`Ref ${wantRef} has no history on remote.`);
            return this.sendEmptyPackFileResponse();
        }

        // clone
        if (haveOid === '0000000000000000000000000000000000000000') {
            await this.sendPackfiles(updates);
            return "";
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
        return "";
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
        return "";
    }

    private async sendPackfiles(updates: EthsUpdate[]) {
        log(`Downloading ${updates.length} packfile(s) for branch.`);
        for (const update of updates) {
            const packKey = update.packfileKey;
            log(`progress downloading packfile ${packKey.slice(0, 10)}...`);

            const packData = await this.contractDriver.downloadPackFile(packKey);
            if (!packData) {
                throw new Error(`Failed to download packfile ${packKey}`);
            }
            process.stdout.write(packData);
        }
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
        const defaultBranchHash = await this.contractDriver.getDefaultBranch(); // bytes20 hash
        if (defaultBranchHash && defaultBranchHash !== "0000000000000000000000000000000000000000") {
            all.push({ ref: 'HEAD', sha: defaultBranchHash });
        }
        return all;
    }

    async close(): Promise<void> {
        await this.contractDriver.close();
    }
}

export default Eths
