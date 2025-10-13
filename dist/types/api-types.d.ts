export type PushRef = {
    src: string;
    dst: string;
    force: boolean;
};
export type FetchRef = {
    ref: string;
    oid: string;
};
export type Api = {
    list: (forPush: boolean) => Promise<string>;
    handlePush: (refs: PushRef[]) => Promise<string>;
    handleFetch: (refs: FetchRef[]) => Promise<string>;
};
