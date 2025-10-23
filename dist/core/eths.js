import pLimit from 'p-limit';
import { ethers } from 'ethers';
import { FlatDirectory } from "ethstorage-sdk";
import { join } from "path";
import { mkdirSync, existsSync, writeFileSync } from "fs";
import { randomRPC } from "../utils/index.js";
import { ContractDriver } from "../storage/contract.js";
import { ETHSAbi } from "../config/abis.js";
import { getOidFromRef, getLocalCommitOids, createPackFileBuffer, runGitIndexPackFromFile, } from "../utils/git-helper.js";
import { log } from "../utils/log.js";
// TODO
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../../.env");
dotenv.config({ path: envPath });
const privateKey = process.env.pk;
export function getPrivateKey() {
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
const ZERO_OID = "0000000000000000000000000000000000000000";
const RPC_CONCURRENCY_LIMIT = 8;
const DOWNLOAD_CONCURRENCY_LIMIT = 15;
class Eths {
    gitdir;
    remoteUrl;
    hubAddress;
    chainId;
    netConfig;
    defaultBranch;
    refs = new Map();
    contractDriver;
    constructor(gitdir, protocol, contractDriver) {
        this.gitdir = gitdir;
        this.remoteUrl = protocol.remoteUrl;
        this.hubAddress = protocol.hubAddress;
        this.chainId = protocol.chainId;
        this.netConfig = protocol.netConfig;
        this.contractDriver = contractDriver;
        this.refs = new Map();
    }
    static async create(gitdir, protocol) {
        const privateKey = getPrivateKey();
        const netConfig = protocol.netConfig;
        const rpcUrl = randomRPC(netConfig.rpc);
        const ethstorageRpc = randomRPC(netConfig.ethStorageRpc);
        const hubAddress = protocol.hubAddress;
        const fd = await FlatDirectory.create({
            rpc: rpcUrl,
            ethStorageRpc: ethstorageRpc,
            privateKey,
            address: hubAddress
        });
        fd.setLogEnabled(false);
        const wallet = new ethers.Wallet(privateKey);
        const contractDriver = new ContractDriver(rpcUrl, wallet, hubAddress, ETHSAbi, fd);
        return new Eths(gitdir, protocol, contractDriver);
    }
    async doList(forPush) {
        console.error("-----doList-----");
        const outLines = [];
        const refs = await this.getRefs();
        for (const ref of refs) {
            if (ref.ref === 'HEAD') {
                // for-push mode usually does not output HEAD, because it is not possible to model to HEAD
                if (!forPush)
                    outLines.push(`${ref.sha} HEAD\n`);
            }
            else {
                outLines.push(`${ref.sha} ${ref.ref}\n`);
            }
            this.refs.set(ref.ref, ref.sha);
        }
        return outLines.join('') + '\n';
    }
    async doFetch(refs) {
        console.error("-----doFetch-----", refs);
        const headRef = refs.find(item => item.ref === 'HEAD');
        const branchRefs = refs.filter(item => item.ref.startsWith('refs/heads/'));
        let finalBranchRefs = [...branchRefs];
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
            await this.fetch(ref.ref);
        }
        await this.close();
        return "\n\n";
    }
    async doPush(refs) {
        console.error("-----doPush-----");
        let outLines = [];
        for (let ref of refs) {
            const { src, dst, force = false } = ref;
            // internalResult：'ok <ref>' or 'error <ref> <reason>'
            let internalResult;
            if (!dst.startsWith('refs/heads/')) {
                // TODO support tag
                internalResult = `error ${dst} refusing to push to non-branch ref`;
            }
            else if (!force) {
                // fast-forward push
                internalResult = await this.handlePush(src, dst);
            }
            else {
                // force push or delete
                if (src === "") {
                    // delete
                    internalResult = await this.handleBranchDeletion(dst, this.defaultBranch);
                }
                else {
                    // force push
                    internalResult = await this.handleForcePush(src, dst);
                }
            }
            if (internalResult.startsWith("error")) {
                // error <ref> <reason> -> ng <ref> <reason>
                const reason = internalResult.slice(6);
                outLines.push(`ng ${reason}\n`);
            }
            else if (internalResult.startsWith("ok")) {
                // ok <ref> -> ok <ref>
                const ref = internalResult.slice(3);
                outLines.push(`ok ${ref}\n`);
                if (src !== "") {
                    const newOid = await getOidFromRef(src);
                    this.refs.set(dst, newOid);
                }
                else {
                    this.refs.delete(dst);
                }
            }
            else {
                outLines.push(`ng ${dst} internal helper error: unknown status\n`);
            }
        }
        await this.close();
        return outLines.join("") + "\n\n";
    }
    // list
    async getRefs() {
        // 1、all branch
        const pageSize = 150;
        let start = 0;
        let all = [];
        while (true) {
            const page = await this.contractDriver.listBranches(start, pageSize);
            if (page.length === 0)
                break;
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
    async fetch(wantRef) {
        const updates = await this.getAllPushRecords(wantRef);
        if (updates.length === 0) {
            log(`Ref ${wantRef} has no history on remote.`);
            this.sendEmptyPackFileResponse();
            return;
        }
        //  pull
        const localOids = await getLocalCommitOids(wantRef);
        const missingPacks = [];
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
            this.sendEmptyPackFileResponse();
            return;
        }
        await this.sendPackfiles(missingPacks.reverse());
    }
    async getAllPushRecords(refName) {
        const allUpdates = [];
        const totalRecords = await this.contractDriver.getPushRecordsCount(refName);
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
        const concurrencyLimiter = pLimit(RPC_CONCURRENCY_LIMIT);
        const fetchTasks = requests.map(req => concurrencyLimiter(async () => {
            return this.contractDriver.getPushRecords(refName, req.start, req.limit);
        }));
        const allPagesUpdates = await Promise.all(fetchTasks);
        for (const updates of allPagesUpdates) {
            allUpdates.push(...updates);
        }
        return allUpdates;
    }
    sendEmptyPackFileResponse() {
        // 'PACK' + 2 (version) + 0 (object count) -> 4 + 4 + 4 = 12 bytes
        const emptyPack = Buffer.from('5041434b0000000200000000', 'hex');
        process.stdout.write(emptyPack);
    }
    async sendPackfiles(updates) {
        const packDir = join(this.gitdir, "objects", "pack");
        if (!existsSync(packDir))
            mkdirSync(packDir, { recursive: true });
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
        const success = results.filter(r => r.status === 'fulfilled');
        const failed = results
            .filter(r => r.status === 'rejected');
        if (failed.length > 0) {
            process.stdout.write("\n");
            log(`[FATAL] ${failed.length} packfile(s) failed to download.`);
            for (const f of failed)
                log(`[ERROR] ${f.reason}`);
            throw new Error('Packfile download failed');
        }
        // provided to git
        for (const { value: packFilePath } of success) {
            await runGitIndexPackFromFile(packFilePath, this.gitdir);
            const keepPath = join(packDir, `${path.basename(packFilePath, '.pack')}.keep`);
            writeFileSync(keepPath, "keep\n");
        }
        // finish
        process.stdout.write("\n");
    }
    // push
    async handlePush(src, dst) {
        try {
            const hasPusherPerm = await this.contractDriver.hasPushPermission();
            if (!hasPusherPerm) {
                return `error ${dst} no push permission`;
            }
            const newOid = await getOidFromRef(src);
            const parentOid = this.refs.get(dst) || "";
            // 1. pack file
            const packFile = await createPackFileBuffer(newOid, parentOid);
            // 2. upload
            log('');
            log(`[PROGRESS] Uploading packfile (Size: ${packFile.length} bytes) to EthStorage...`);
            let status = await this.contractDriver.uploadPack(dst, newOid, packFile);
            if (!status) {
                return `error ${dst} upload pack file fail`;
            }
            // 3. update
            status = await this.contractDriver.writeRef({
                refName: dst,
                parentOid: parentOid,
                newOid: newOid,
                size: packFile.length,
            });
            if (!status) {
                return `error ${dst} update refs fail`;
            }
            return `ok ${dst}`;
        }
        catch (err) {
            return `error ${dst} ${err.message}`;
        }
    }
    async handleForcePush(src, dst) {
        try {
            const hasPusherPerm = await this.contractDriver.hasForcePushPermission(dst);
            if (!hasPusherPerm) {
                return `error ${dst} no force push permission`;
            }
            const newOid = await getOidFromRef(src);
            // 1. get all history
            const chainRecords = await this.getAllPushRecords(dst);
            const localOids = await getLocalCommitOids(src);
            // 2. find modify index
            let commonOid = null;
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
            let packFile;
            let parentOid;
            let parentIndex;
            if (commonOid) {
                packFile = await createPackFileBuffer(newOid, commonOid);
                parentOid = commonOid;
                parentIndex = commonIndex;
                log(`[INFO] Force push: Partial override (Ancestor: ${parentOid}, Index: ${parentIndex})`);
            }
            else {
                packFile = await createPackFileBuffer(newOid);
                parentOid = ZERO_OID;
                parentIndex = 0;
                log(`[INFO] Force push: Full override (No common ancestor).`);
            }
            // 4. upload pack file
            log('');
            log(`[PROGRESS] Uploading packfile (Size: ${packFile.length} bytes) to EthStorage...`);
            let status = await this.contractDriver.uploadPack(dst, newOid, packFile);
            if (!status) {
                return `error ${dst} upload pack file fail`;
            }
            // 5. update refs
            status = await this.contractDriver.writeForceRef({
                refName: dst,
                parentOid: parentOid,
                newOid: newOid,
                size: packFile.length,
                parentIndex: parentIndex,
            });
            if (!status) {
                return `error ${dst} update refs fail`;
            }
            return `ok ${dst}`;
        }
        catch (err) {
            return `error ${dst} ${err.message}`;
        }
    }
    async handleBranchDeletion(dst, defaultBranchRef) {
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
        }
        catch (err) {
            return `error ${dst} ${err.message}`;
        }
    }
    async close() {
        await this.contractDriver.close();
    }
}
export default Eths;
