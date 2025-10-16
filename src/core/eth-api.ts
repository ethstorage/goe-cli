import { Api } from '../types/api-types.js';
import { parseEthsURI } from "../utils/index.js";
import Eths from "./eths.js";

let eths: Eths;

export async function createImpl(env: NodeJS.ProcessEnv): Promise<Api> {
  // init sdk
  const gitdir = env['GIT_DIR'] || '.git';
  const [, , , remoteUrl] = process.argv
  const protocol = await parseEthsURI(remoteUrl);

  eths = await Eths.create(gitdir, protocol);


  return {
    list: async (forPush) => {
      return await eths.doList(forPush);
    },
    handlePush: async (refs) => {
      return await eths.doPush(refs);
    },
    handleFetch: async (p) => {
      return await eths.doFetch(p);
    },
    close: async () => {
      await eths.close();
    }
  };
}
