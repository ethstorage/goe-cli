import { Contract, ethers } from "ethers";
import { GOEFactoryAbi } from "../config/index.js";
import { getNetworkConfig, randomRPC }  from "./utils.js";

export async function getHubContract(
    chainId: number,
    signer: ethers.Signer | null = null
): Promise<ethers.Contract> {
    const network = getNetworkConfig(chainId);
    if (signer) {
        return new Contract(network.hubAddress, GOEFactoryAbi, signer);
    } else {
        const rpcUrl = randomRPC(network.rpc);
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        return new Contract(network.hubAddress, GOEFactoryAbi, provider);
    }
}
