import { ethers } from "ethers";
import { Networks } from "../config/index.js";

export function validateAddress(address: string, label = "address") {
    if (!ethers.isAddress(address)) {
        throw new Error(`Invalid ${label}: ${address}`);
    }
}

export function randomRPC(rpcs: string[]): string {
    return rpcs[Math.floor(Math.random() * rpcs.length)];
}

export function getNetworkConfig(chainId: number) {
    const config = Networks[chainId];
    if (!config) {
        throw new Error(`Unsupported chain ID: ${chainId}.`);
    }
    return config;
}
