export const Networks: Record<number, any> = {
    11155111: {
        name: "Sepolia",
        nativeCurrency: {
            name: "ETH",
            symbol: "ETH",
            decimals: 18,
        },
        rpc: ["http://65.108.230.142:8545/"],
        ethStorageRpc: ['https://rpc.testnet.ethstorage.io:9546'],
        explorers: [
            {
                name: "Sepolia",
                url: "https://sepolia.etherscan.io/",
                standard: "EIP3091",
            },
        ],
        txConst: {
            blockTimeSec: 7,
            rbfTimes: 5,
            boardcastTimes: 15,
        },
        hubAddress: "0xA400A766cac75EF3Eb605f23a6a473dB5d4AbBBf",
    },
}
