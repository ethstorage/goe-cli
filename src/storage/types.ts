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
