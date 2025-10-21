export interface Update {
  refName: string;        // bytes32
  parentOid: string;         // bytes20
  newOid: string;         // bytes20
  size: number;           // uint256
  parentIndex?: number;
}

export type Ref = {
  ref: string
  sha: string
}

export interface EthsUpdate {
  refName: string;
  parentOid: string; // bytes20
  newOid: string; // bytes20
  packfileKey: string; // bytes20
  size: number;
  timestamp: number;
  pusher: string;
}
