import { Contract, ethers } from "ethers";
import { GOERepoAbi } from "../config/index.js";
import { validateAddress, randomRPC, getNetworkConfig } from "./utils.js";

export async function getRepoContract(
    repoAddress: string,
    chainId: number,
    signer: ethers.Signer | null = null
): Promise<ethers.Contract> {
    validateAddress(repoAddress, "repoAddress");
    if (signer) {
        return new Contract(repoAddress, GOERepoAbi, signer);
    } else {
        const network = getNetworkConfig(chainId);
        const rpcUrl = randomRPC(network.rpc);
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        return new Contract(repoAddress, GOERepoAbi, provider);
    }
}
