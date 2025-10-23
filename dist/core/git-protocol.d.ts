import { Api } from '../types/index.js';
export default function GitRemoteHelper({ stdin, api }: {
    stdin: NodeJS.ReadStream;
    api: Api;
}): Promise<void>;
