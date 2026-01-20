import { ethers, ZeroAddress } from "ethers";
import { getHubContract } from "../hub.js";

export async function resolveRepoAddress(
    chainId: number,
    input: string,
    defaultOwner?: string
): Promise<string> {
    // 1. address
    const strInput: string = input; // fix ts build bug
    if (ethers.isAddress(strInput)) {
        return strInput;
    }

    // 2. owner/repo
    if (input.includes("/")) {
        const [owner, repoName] = input.split("/");
        if (!owner || !repoName) {
            throw new Error(`Invalid repo identifier: "${input}"`);
        }
        if (ethers.isAddress(repoName)) {
            throw new Error(
                `Invalid repo identifier "${input}". Use repo address directly.`
            );
        }
        return await resolveByName(chainId, owner, repoName);
    }

    // 3. repoName only
    if (!defaultOwner) {
        throw new Error(`Owner is required to resolve repo name "${input}"`);
    }
    return await resolveByName(chainId, defaultOwner, input);
}

async function resolveByName(
    chainId: number,
    owner: string,
    repoName: string
): Promise<string> {
    const factory = await getHubContract(chainId);
    repoName = ethers.hexlify(ethers.toUtf8Bytes(repoName));
    const repo = await factory.getRepoByName(owner, repoName);
    if (!repo || repo === ZeroAddress) {
        throw new Error(`Repository "${owner}/${repoName}" not found`);
    }
    return repo;
}
