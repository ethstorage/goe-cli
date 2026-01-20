import { ethers } from "ethers";
import {
    GOEFactoryAbi,
    WalletManager,
    validateAddress, randomRPC, getNetworkConfig,
    resolveRepoAddress, getHubContract, getRepoContract
} from "../../core/index.js"

export interface RepoInfo {
    address: string;
    name: string;
    creationTime: Date;
}

/**
 * ============================
 * Common Helpers
 * ============================
 */
function getOwner(): string {
    const address = WalletManager.getDefaultAddress();
    if (!address) throw new Error(`Wallet not found. Please run 'goe wallet create' to create it.`);
    return address;
}

async function getSigner(chainId: number): Promise<ethers.Signer> {
    const walletData = await WalletManager.getWallet();
    const netConfig = getNetworkConfig(chainId);
    const rpcUrl = randomRPC(netConfig.rpc);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    return new ethers.Wallet(walletData.privateKey, provider);
}

async function waitForTx(tx: ethers.ContractTransactionResponse, action: string) {
    const receipt = await tx.wait();
    if (!receipt?.status) {
        throw new Error(`❌ Transaction failed during: ${action} (tx: ${tx.hash})`);
    }
    return receipt;
}

/**
 * ============================
 * Factory Contract Methods
 * ============================
 */
export namespace Factory {
    export async function createRepo(repoName: string, chainId: number): Promise<string> {
        const signer = await getSigner(chainId);
        const factory = await getHubContract(chainId, signer);
        const tx = await factory.createRepo(ethers.toUtf8Bytes(repoName));
        const receipt = await waitForTx(tx, "createRepo");

        const iface = new ethers.Interface(GOEFactoryAbi);
        for (const log of receipt.logs) {
            try {
                const parsed = iface.parseLog(log);
                if (parsed?.name === "RepoCreated") {
                    return parsed.args.repo;
                }
            } catch { /* skip */ }
        }
        throw new Error("Transaction succeeded but no 'RepoCreated' event found");
    }

    export async function getReposPaginated(
        chainId: number,
        start = 0,
        limit = 50
    ): Promise<RepoInfo[]> {
        const factory = await getHubContract(chainId);
        const owner = getOwner();

        const repos = await factory.getReposPaginated(owner, start, limit);
        return repos.map((r: any) => ({
            address: r.repoAddress,
            name: ethers.toUtf8String(r.repoName),
            creationTime: new Date(Number(r.creationTime) * 1000),
        }));
    }
}

/**
 * ============================
 * Repository Contract Methods
 * ============================
 */
function normalizeBranchName(branch: string): string {
    if (branch.startsWith("refs/")) return branch;

    // tags
    if (branch.startsWith("tags/")) {
        return `refs/${branch}`;
    }

    // heads
    return `refs/heads/${branch}`;
}

export namespace Repo {
    export async function setDefaultBranch(repoNamespace: string, chainId: number, branchName: string) {
        const signer = await getSigner(chainId);
        const repoAddress = await resolveRepoAddress(chainId, repoNamespace, getOwner());
        const repo = await getRepoContract(repoAddress, chainId, signer);
        const fullName = normalizeBranchName(branchName);

        // check
        const branches = await Repo.listBranches(repoAddress, chainId, repo);
        const exists = branches.some(b => normalizeBranchName(b.name) === fullName);
        if (!exists) {
            throw new Error(
                `Branch "${branchName}" does not exist on this repository.`
            );
        }

        const tx = await repo.setDefaultBranch(ethers.toUtf8Bytes(fullName));
        await waitForTx(tx, "setDefaultBranch");
    }

    export async function addPusher(repoNamespace: string, chainId: number, account: string) {
        validateAddress(account, "account");
        const signer = await getSigner(chainId);
        const repoAddress = await resolveRepoAddress(chainId, repoNamespace, getOwner());
        const repo = await getRepoContract(repoAddress, chainId, signer);
        const tx = await repo.addPusher(account);
        await waitForTx(tx, "addPusher");
    }

    export async function removePusher(repoNamespace: string, chainId: number, account: string) {
        validateAddress(account, "account");
        const signer = await getSigner(chainId);
        const repoAddress = await resolveRepoAddress(chainId, repoNamespace, getOwner());
        const repo = await getRepoContract(repoAddress, chainId, signer);
        const tx = await repo.removePusher(account);
        await waitForTx(tx, "removePusher");
    }

    export async function addMaintainer(repoNamespace: string, chainId: number, account: string) {
        validateAddress(account, "account");
        const signer = await getSigner(chainId);
        const repoAddress = await resolveRepoAddress(chainId, repoNamespace, getOwner());
        const repo = await getRepoContract(repoAddress, chainId, signer);
        const tx = await repo.addMaintainer(account);
        await waitForTx(tx, "addMaintainer");
    }

    export async function canPush(repoNamespace: string, chainId: number, account: string) {
        validateAddress(account, "account");
        const repoAddress = await resolveRepoAddress(chainId, repoNamespace, getOwner());
        const repo = await getRepoContract(repoAddress, chainId);
        return repo.canPush(account);
    }

    export async function canForcePush(repoNamespace: string, chainId: number, refName: string, account: string) {
        validateAddress(account, "account");
        const repoAddress = await resolveRepoAddress(chainId, repoNamespace, getOwner());
        const repo = await getRepoContract(repoAddress, chainId);
        return repo.canForcePush(account, ethers.toUtf8Bytes(refName));
    }

    export async function listBranches(repoNamespace: string, chainId: number, repoContract?: ethers.Contract) {
        const pageSize = 50;
        const repo = repoContract ?? await getRepoContract(await resolveRepoAddress(chainId, repoNamespace, getOwner()), chainId);

        let start = 0;
        const all: { name: string; hash: string }[] = [];

        while (true) {
            const items = await repo.listBranches(start, pageSize);
            if (items.length === 0) break;

            const mapped = items.map((b: any) => {
                const raw = ethers.toUtf8String(b.name); // bytes → string
                const clean = raw.startsWith("refs/heads/")
                    ? raw.replace("refs/heads/", "")
                    : raw.startsWith("refs/")
                        ? raw.replace("refs/", "")
                        : raw;
                return {
                    name: clean,
                    hash: ethers.hexlify(b.hash).slice(2)
                };
            });
            all.push(...mapped);

            if (items.length < pageSize) break;
            start += pageSize;
        }
        return all;
    }

    export async function getDefaultBranch(repoNamespace: string, chainId: number) {
        const repoAddress = await resolveRepoAddress(chainId, repoNamespace, getOwner());
        const repo = await getRepoContract(repoAddress, chainId);
        const [refBytes,] = await repo.getDefaultBranch();
        if (refBytes.length === 0) {
            return null;
        }
        const branch = ethers.toUtf8String(refBytes);
        return branch.startsWith("refs/heads/")
            ? branch.replace("refs/heads/", "")
            : branch.startsWith("refs/")
                ? branch.replace("refs/", "")
                : branch;
    }
}
