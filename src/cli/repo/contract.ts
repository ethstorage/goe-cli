import { ethers, Contract } from "ethers";
import { getWallet } from "../../core/wallet/index.js";
import { Networks } from "../../core/config/index.js"

import { ETHSFactoryAbi, ETHSRepoAbi } from "../../core/config/abis.js";


export interface RepoInfo {
    address: string;
    name: string;
    creationTime: Date;
}

async function findWallet() {
    const decryptedWallet = await getWallet();
    return new ethers.Wallet(decryptedWallet.privateKey);
}

// factory
export async function createRepo(repoName: string): Promise<string | null> {
    const signer = findWallet();
    const contract: Contract = new ethers.Contract(ETHSHUB_ADDRESS, ETHSFactoryAbi, signer);

    const tx = await contract.createRepo(ethers.toUtf8Bytes(repoName));
    const receipt: ContractReceipt = await tx.wait();

    const event: Event | undefined = receipt.events?.find(e => e.event === 'RepoCreated');
    return event?.args?.repoAddress ?? null;
}

export async function getUserReposPaginated(start = 0, limit = 20): Promise<RepoInfo[]> {
    const signer = getWalletSigner();
    const contract: Contract = new ethers.Contract(ETHSHUB_ADDRESS, ETHSFactoryAbi, signer);
    const user: string = await signer.getAddress();

    const repos: { repoAddress: string; repoName: Uint8Array; creationTime: ethers.BigNumber }[] =
        await contract.getUserReposPaginated(user, start, limit);

    return repos.map(r => ({
        address: r.repoAddress,
        name: ethers.utils.toUtf8String(r.repoName),
        creationTime: new Date(r.creationTime.toNumber() * 1000),
    }));
}

// repo
export async function setDefaultBranch(repoAddress: string, branchName: string): Promise<void> {
    const signer = getWalletSigner();
    const contract: Contract = new ethers.Contract(repoAddress, ETHSRepoAbi, signer);
    const tx = await contract.setDefaultBranch(ethers.utils.toUtf8Bytes(branchName));
    await tx.wait();
}

export async function addPusher(repoAddress: string, account: string): Promise<void> {
    const signer = getWalletSigner();
    const contract: Contract = new ethers.Contract(repoAddress, ETHSHUB_ABI, signer);
    const tx = await contract.addPusher(account);
    await tx.wait();
}

export async function removePusher(repoAddress: string, account: string): Promise<void> {
    const signer = getWalletSigner();
    const contract: Contract = new ethers.Contract(repoAddress, ETHSHUB_ABI, signer);
    const tx = await contract.removePusher(account);
    await tx.wait();
}

export async function addMaintainer(repoAddress: string, account: string): Promise<void> {
    const signer = getWalletSigner();
    const contract: Contract = new ethers.Contract(repoAddress, ETHSHUB_ABI, signer);
    const tx = await contract.addMaintainer(account);
    await tx.wait();
}

export async function canPush(repoAddress: string, account: string): Promise<boolean> {
    const signer = getWalletSigner();
    const contract: Contract = new ethers.Contract(repoAddress, ETHSHUB_ABI, signer);
    return contract.canPush(account);
}

export async function canForcePush(repoAddress: string, refName: string, account: string): Promise<boolean> {
    const signer = getWalletSigner();
    const contract: Contract = new ethers.Contract(repoAddress, ETHSHUB_ABI, signer);
    return contract.canForcePush(account, ethers.utils.toUtf8Bytes(refName));
}

export async function canMaintain(repoAddress: string, account: string): Promise<boolean> {
    const signer = getWalletSigner();
    const contract: Contract = new ethers.Contract(repoAddress, ETHSHUB_ABI, signer);
    return contract.canMaintain(account);
}
