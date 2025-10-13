
export const ETHSAbi = [
    "function getDefaultBranch() external view returns (bytes20 hash)",
    "function listBranchesPaginated(uint256 start, uint256 limit) view returns (tuple(bytes name, bytes20 hash)[] list)",
    "function pushUpdate(bytes calldata refName, bytes20 oldOid, bytes20 newOid, uint256 fileSize) external"
];
