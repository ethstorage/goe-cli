import { Api } from '../types/api-types.js';
export default function GitRemoteHelper({ stdin, api }: {
    stdin: NodeJS.ReadStream;
    api: Api;
}): Promise<void>;
