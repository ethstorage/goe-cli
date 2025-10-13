import { ethers } from 'ethers';
import { EthsProtocol, randomRPC } from "../utils/index.js";
import { ContractDriver } from "../storage/contract.js";
import { ETHSAbi } from "../config/abis.js";
import { Ref } from "../storage/types.js";
import { runCmdCapture, createPackFile } from "../utils/git-helper.js";

import { log } from "../utils/log.js"
import { FetchRef, PushRef } from "../types/api-types.js";
import { FlatDirectory } from "ethstorage-sdk";

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

    // @ts-ignore
    // TODO
    return '';
}

class Eths {
    gitdir: string
    remoteName: string
    remoteUrl: string
    hubAddress: string
    chainId: number
    netConfig: Record<string, any>

    refs: Map<string, string> = new Map()
    pushed: Map<string, string> = new Map()
    fetchPending: Map<string, number> = new Map()

    contractDriver: ContractDriver

    constructor(gitdir: string, remoteName: string, protocol: EthsProtocol, contractDriver: ContractDriver) {
        this.gitdir = gitdir
        this.remoteName = remoteName
        this.remoteUrl = protocol.remoteUrl
        this.hubAddress = protocol.hubAddress
        this.chainId = protocol.chainId
        this.netConfig = protocol.netConfig
        this.contractDriver = contractDriver;

        this.refs = new Map()
        this.pushed = new Map()
    }

    static async create(options: {
        gitdir: string;
        remoteName: string;
        protocol: EthsProtocol
    }): Promise<Eths> {
        const { gitdir, remoteName, protocol } = options;
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
        return new Eths(gitdir, remoteName, protocol, contractDriver);
    }

    async doList(forPush: boolean) {
        const outLines: string[] = [];
        const refs = await this.getRefs();

        for (const ref of refs) {
            if (ref.ref === 'HEAD') {
                if(!forPush) outLines.push(`@${ref.sha} HEAD\n`);
            } else {
                outLines.push(`${ref.sha} ${ref.ref}\n`);
            }
            this.refs.set(ref.ref, ref.sha);
        }

        return outLines.join('') + '\n';
    }

    async doFetch(refs: FetchRef[]) {
        console.error("-----doFetch-----")
        for (let ref of refs) {
            await this.fetch(ref.oid)
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

        return outLines.join("") + "\n"
    }

    async fetch(oid: string) {
        if (this.fetchPending.has(oid)) {
            let cnt = this.fetchPending.get(oid)!
            this.fetchPending.set(oid, cnt + 1)
            return
        }
        this.fetchPending.set(oid, 1)

        // let fetching: Promise<void>[] = []
        // if (GitUtils.objectExists(oid)) {
        //     if (oid == GitUtils.EMPTY_TREE_HASH) {
        //         GitUtils.writeObject("tree", Buffer.from(""))
        //     }
        //     if (!GitUtils.historyExists(oid)) {
        //         // log("missing part of history from", oid)
        //         for (let sha of GitUtils.referencedObjects(oid)) {
        //             fetching.push(this.fetch(sha))
        //         }
        //     } else {
        //         // log("already downloaded", oid)
        //     }
        // } else {
        //     let error = await this.download(oid)
        //     if (!error) {
        //         for (let sha of GitUtils.referencedObjects(oid)) {
        //             fetching.push(this.fetch(sha))
        //         }
        //     } else {
        //         throw error
        //         //fetching.push(this.fetch(oid))
        //     }
        // }
        // await Promise.all(fetching)
        // this.fetchPending.set(oid, 0)
    }

    async download(sha: string): Promise<Error | null> {
        // log("fetching...", sha)
        // let [status, data] = await this.storage.download(sha) //this.objectPath(sha)
        // if (status == Status.SUCCEED) {
        //     let computedSha = GitUtils.decodeObject(data)
        //     if (computedSha != sha) {
        //         return new Error(`sha mismatch ${computedSha} != ${sha}`)
        //     }
        // } else {
        //     return new Error(`download failed ${sha}`)
        // }
        return null
    }

    async pushPackFile(src: string, dst: string) {
        try {
            const newOid = (await runCmdCapture(["git", "rev-parse", src])).trim();
            const oldOid = this.refs.get(dst) || "";

            // 1. pack file
            const { path, size } = await createPackFile(newOid, oldOid);

            // 2. upload
            log(`progress start pushing ${dst}`);
            let status = await this.contractDriver.uploadPack(dst, newOid, path);
            if (!status) {
                return `error ${dst} upload pack file fail`;
            }

            // 3. update
            status = await this.contractDriver.writeRef(dst, {
                refName: dst,
                oldOid: oldOid,
                newOid: newOid,
                size: size,
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
}

export default Eths
