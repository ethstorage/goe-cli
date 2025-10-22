export interface Update {
    refName: string;
    parentOid: string;
    newOid: string;
    size: number;
    parentIndex?: number;
}
export type Ref = {
    ref: string;
    sha: string;
};
export interface EthsUpdate {
    refName: string;
    parentOid: string;
    newOid: string;
    packfileKey: string;
    size: number;
    timestamp: number;
    pusher: string;
}
