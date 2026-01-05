import { ethers, Contract } from "ethers";
import { getWallet } from "../../core/wallet/index.js";
import { GOEFactoryAbi, GOERepoAbi, Networks } from "../../core/config/index.js"

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

function randomRPC(rpcs: string[]): string {
    return rpcs[Math.floor(Math.random() * rpcs.length)];
}

function getNetworkConfig(chainId: number) {
    const config = Networks[chainId];
    if (!config) {
        throw new Error(`Unsupported chain ID: ${chainId}.`);
    }
    return config;
}

async function getSigner(chainId: number): Promise<ethers.Signer> {
    const walletData = await getWallet();
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

function validateAddress(address: string, label = "address") {
    if (!ethers.isAddress(address)) {
        throw new Error(`Invalid ${label}: ${address}`);
    }
}

async function getRepoContract(repoAddress: string, chainId: number) {
    validateAddress(repoAddress, "repoAddress");
    const signer = await getSigner(chainId);
    return new Contract(repoAddress, GOERepoAbi, signer);
}

/**
 * ============================
 * Factory Contract Methods
 * ============================
 */
export namespace Factory {
    export async function createRepo(repoName: string, chainId: number): Promise<string> {
        const signer = await getSigner(chainId);
        const { hubAddress } = getNetworkConfig(chainId);

        const factory = new Contract(hubAddress, GOEFactoryAbi, signer);
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

    export async function getUserReposPaginated(
        chainId: number,
        start = 0,
        limit = 50
    ): Promise<RepoInfo[]> {
        const signer = await getSigner(chainId);
        const { hubAddress } = getNetworkConfig(chainId);

        const userAddress = await signer.getAddress();
        const factory = new Contract(hubAddress, GOEFactoryAbi, signer);
        const repos = await factory.getUserReposPaginated(userAddress, start, limit);
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
export namespace Repo {
    export async function setDefaultBranch(repoAddress: string, chainId: number, branchName: string) {
        const repo = await getRepoContract(repoAddress, chainId);

        const fullName = normalizeBranchName(branchName);

        // check
        const branches = await Repo.listBranches(repoAddress, chainId);
        const exists = branches.some(b => normalizeBranchName(b.name) === fullName);
        if (!exists) {
            throw new Error(
                `Branch "${branchName}" does not exist on this repository.`
            );
        }

        const tx = await repo.setDefaultBranch(ethers.toUtf8Bytes(fullName));
        await waitForTx(tx, "setDefaultBranch");
    }

    export async function addPusher(repoAddress: string, chainId: number, account: string) {
        validateAddress(account, "account");
        const repo = await getRepoContract(repoAddress, chainId);
        const tx = await repo.addPusher(account);
        await waitForTx(tx, "addPusher");
    }

    export async function removePusher(repoAddress: string, chainId: number, account: string) {
        validateAddress(account, "account");
        const repo = await getRepoContract(repoAddress, chainId);
        const tx = await repo.removePusher(account);
        await waitForTx(tx, "removePusher");
    }

    export async function addMaintainer(repoAddress: string, chainId: number, account: string) {
        validateAddress(account, "account");
        const repo = await getRepoContract(repoAddress, chainId);
        const tx = await repo.addMaintainer(account);
        await waitForTx(tx, "addMaintainer");
    }

    export async function canPush(repoAddress: string, chainId: number, account: string) {
        validateAddress(account, "account");
        const repo = await getRepoContract(repoAddress, chainId);
        return repo.canPush(account);
    }

    export async function canForcePush(repoAddress: string, chainId: number, refName: string, account: string) {
        validateAddress(account, "account");
        const repo = await getRepoContract(repoAddress, chainId);
        return repo.canForcePush(account, ethers.toUtf8Bytes(refName));
    }

    export async function listBranches(repoAddress: string, chainId: number, pageSize: number = 50) {
        const repo = await getRepoContract(repoAddress, chainId);

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

    export async function getDefaultBranch(repoAddress: string, chainId: number) {
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

function normalizeBranchName(branch: string): string {
    if (branch.startsWith("refs/")) return branch;

    // tags
    if (branch.startsWith("tags/")) {
        return `refs/${branch}`;
    }

    // heads
    return `refs/heads/${branch}`;
}
