
export const GOEFactoryAbi = [
    "event RepoCreated(address indexed repo, address indexed creator, bytes repoName)",
    "function createRepo(bytes repoName) external returns (address)",
    "function getUserRepoCount(address user) external view returns (uint256)",
    "function getUserReposPaginated(address user, uint256 start, uint256 limit) external view returns (tuple(address repoAddress, uint256 creationTime, bytes repoName)[])"
];


export const GOERepoAbi = [
    "function addPusher(address account) external",
    "function removePusher(address account) external",
    "function addMaintainer(address account) external",
    "function setDefaultBranch(bytes calldata branchName) external",

    "function getDefaultBranch() external view returns (bytes memory name, bytes20 hash)",
    "function listBranches(uint256 start, uint256 limit) external view returns (tuple(bytes name, bytes20 hash)[] memory list)",
    "function canPush(address account) external view returns (bool)",
    "function canForcePush(address account, bytes calldata refName) external view returns (bool)",
    "function getBranchHead(bytes calldata refName) external view returns (bytes20 headOid, bool exists)",
    "function getPushRecords(bytes calldata refName, uint256 start, uint256 limit) external view returns (tuple(bytes20 newOid, bytes20 parentOid, bytes packfileKey, uint256 size, uint256 timestamp, address pusher)[] memory)",
    "function getPushRecordCount(bytes calldata refName) external view returns (uint256 count)",

    "function push(bytes calldata refName, bytes20 parentOid, bytes20 newOid, bytes calldata packfileKey, uint256 packfileSize) external",
    "function forcePush(bytes calldata refName, bytes20 newOid, bytes calldata packfileKey, uint256 packfileSize, bytes20 parentOid, uint256 parentIndex) external",
];
