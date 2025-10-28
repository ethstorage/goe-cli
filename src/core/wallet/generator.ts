import { ethers } from 'ethers';

export function generatePrivateKey(): { privateKey: string; address: string } {
    const wallet = ethers.Wallet.createRandom();
    return {
        privateKey: wallet.privateKey,
        address: wallet.address
    };
}
