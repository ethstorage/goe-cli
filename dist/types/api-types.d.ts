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
    close: () => Promise<void>;
};
export declare enum GitCommands {
    capabilities = "capabilities",
    option = "option",
    list = "list",
    push = "push",
    fetch = "fetch"
}
type CommandCapabilities = {
    command: GitCommands.capabilities;
};
type CommandOption = {
    command: GitCommands.option;
    key: string;
    value: string;
};
type CommandList = {
    command: GitCommands.list;
    forPush: boolean;
};
type CommandPush = {
    command: GitCommands.push;
    refs: PushRef[];
};
type CommandFetch = {
    command: GitCommands.fetch;
    refs: FetchRef[];
};
export type Command = CommandCapabilities | CommandOption | CommandList | CommandPush | CommandFetch;
export {};
