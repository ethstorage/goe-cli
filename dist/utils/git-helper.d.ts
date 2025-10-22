export declare function runCmdCapture(args: string[]): Promise<string>;
export declare function createPackFileBuffer(newOid: string, parentOid?: string): Promise<Buffer>;
export declare function runGitIndexPackFromBuf(buf: Buffer, gitDir: string): Promise<void>;
export declare function getLocalCommitOids(refName: string): Promise<Set<string>>;
