export interface Update {
  refName: string;        // bytes32
  oldOid: string;         // bytes20
  newOid: string;         // bytes20
  size: number;           // uint256
}

export type Ref = {
  ref: string
  sha: string
}

export interface EthsUpdate {
  refName: string;
  oldOid: string; // bytes20
  newOid: string; // bytes20
  packfileKey: string; // bytes20
  size: number;
  timestamp: number;
  pusher: string;
}
