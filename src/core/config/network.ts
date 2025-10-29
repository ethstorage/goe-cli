export const Networks: Record<number, any> = {
    3335: {
        name: "QuarkChain Beta L2",
        nativeCurrency: {
            name: "QKC",
            symbol: "QKC",
            decimals: 18,
        },
        rpc: ["https://rpc.beta.testnet.l2.quarkchain.io:8545"],
        ethStorageRpc: ['https://rpc.beta.testnet.l2.ethstorage.io:9596'],
        explorers: [
            {
                name: "quarkchain l2",
                url: "https://explorer.beta.testnet.l2.quarkchain.io/",
                standard: "EIP3091",
            },
        ],
        txConst: {
            blockTimeSec: 7,
            rbfTimes: 5,
            boardcastTimes: 15,
        },
        hubAddress: "0x96f7849C6D0EB09024e482Cc9c249096e3368a16",
    },
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
        hubAddress: "0x974c0852906eFc13De7D28966653B29190Ae5966",
    },
}
