import { superpathjoin as join } from 'superpathjoin'
import { Api } from '../types/api-types.js';
import { parseEthsURI } from "../utils/index.js";
import Eths from "./eths.js";

// implementation that wires storage & contract stubs.
let eths: Eths;

export async function createImpl(env: NodeJS.ProcessEnv): Promise<Api> {
  // init sdk
  const getDir = () => {
    if (typeof env['GIT_DIR'] !== 'string') {
      // throw new Error('Missing GIT_DIR env #tVJpoU')
      return join(__dirname, ".git")
    }
    return env['GIT_DIR']
  }
  const gitdir = join(process.cwd(), getDir())
  const [, , remoteName, remoteUrl] = process.argv
  const protocol = await parseEthsURI(remoteUrl);

  eths = await Eths.create({gitdir, remoteName, protocol});


  return {
    list: async (forPush) => {
      return await eths.doList(forPush);
    },
    handlePush: async (refs) => {
      return await eths.doPush(refs);
    },
    handleFetch: async (p) => {
      return await eths.doFetch(p);
    }
  };
}
