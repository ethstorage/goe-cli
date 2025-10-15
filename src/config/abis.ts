
export const ETHSAbi = [
    "function getDefaultBranch() external view returns (bytes20 hash)",
    "function listBranchesPaginated(uint256 start, uint256 limit) view returns (tuple(bytes name, bytes20 hash)[] list)",
    "function pushUpdate(bytes calldata refName, bytes20 oldOid, bytes20 newOid, uint256 fileSize) external",
    "function getRef(bytes calldata refName) external view returns (bytes20)",
    "function getBranchUpdateCount(bytes calldata refName) external view returns (uint256)",
    "function getBranchUpdates(bytes calldata refName, uint256 start, uint256 limit) external view returns (tuple(bytes refName, bytes20 oldOid, bytes20 newOid, bytes20 packfileKey, uint256 size, uint256 timestamp, address pusher)[] memory)"
];
