import { ethers, ZeroAddress } from "ethers";
import { getHubContract } from "../hub.js";
import { getNetworkConfig, randomRPC } from "../utils.js";

/**
 * Resolves a repository identifier to its contract address.
 *
 * CLI supports shorthand repoName (defaultOwner required).
 * Git helper must always provide full URI (owner/repo or contract address).
 */
export async function resolveRepoAddress(
    chainId: number,
    input: string,
    defaultOwner?: string
): Promise<string> {
    // 1. Direct address check
    const strInput: string = input; // fix ts build bug
    if (ethers.isAddress(strInput)) {
        return strInput;
    }

    let ownerIdentifier: string;
    let repoName: string;

    // 2. Determine if it's a full path (owner/repo) or shorthand (repo)
    const slashIndex = input.indexOf("/");
    if (slashIndex !== -1) {
        // Handle "owner/repo" or "owner.eth/repo/sub-path"
        ownerIdentifier = input.substring(0, slashIndex);
        repoName = input.substring(slashIndex + 1);
        if (!ownerIdentifier || !repoName) {
            throw new Error(`Invalid repository identifier format: "${input}"`);
        }
    } else {
        // Shorthand: repoName only
        if (!defaultOwner) {
            throw new Error(`Owner identification required to resolve repository: "${input}"`);
        }
        ownerIdentifier = defaultOwner;
        repoName = input;
    }

    // 3. Resolve Identity (ENS with goe:// worker logic or direct Address)
    const finalOwner = await resolveOwnerAddress(chainId, ownerIdentifier);

    // 4. Fetch Repo address from the Factory (Hub) contract
    return await resolveByName(chainId, finalOwner, repoName);
}

/**
 * Resolves the owner's address.
 * Supports ENS resolution with a fallback to the "goe://" text record (worker wallet).
 */
async function resolveOwnerAddress(chainId: number, ownerIdentifier: string): Promise<string> {
    const owner: string = ownerIdentifier; // fix ts build bug
    if (ethers.isAddress(owner)) {
        return owner;
    }

    if (ownerIdentifier.endsWith(".eth")) {
        const network = getNetworkConfig(chainId);
        const rpcUrl = randomRPC(network.rpc);
        const provider = new ethers.JsonRpcProvider(rpcUrl);

        const resolver = await provider.getResolver(ownerIdentifier);
        if (!resolver) {
            throw new Error(`ENS resolver not found for domain: ${ownerIdentifier}`);
        }

        // 1. Priority: Try to get the dedicated GOE worker address from Text Records
        const workerAddr = await resolver.getText("goe://");
        if (workerAddr && ethers.isAddress(workerAddr)) {
            return workerAddr;
        }

        // 2. Fallback: Use the primary ETH address bound to the ENS name
        const ownerAddr = await resolver.getAddress();
        if (!ownerAddr || ownerAddr === ZeroAddress) {
            throw new Error(`ENS name "${ownerIdentifier}" does not resolve to a valid address`);
        }
        return ownerAddr;
    }

    throw new Error(`Invalid owner identifier: "${ownerIdentifier}". Must be an Ethereum address or .eth domain.`);
}

/**
 * Queries the Hub/Factory contract to find the repository address by owner and name.
 */
async function resolveByName(
    chainId: number,
    owner: string,
    repoName: string
): Promise<string> {
    const factory = await getHubContract(chainId);
    // Convert string name to hex bytes as required by the contract
    const repoNameBytes = ethers.hexlify(ethers.toUtf8Bytes(repoName));
    const repoAddress = await factory.getRepoByName(owner, repoNameBytes);
    if (!repoAddress || repoAddress === ZeroAddress) {
        throw new Error(`Repository "${repoName}" owned by "${owner}" not found on chain ${chainId}`);
    }
    return repoAddress;
}
