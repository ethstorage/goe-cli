import * as path from 'path';

import { Api } from '../types/index.js';
import { parseGoeURI } from "../utils/index.js";
import Goe from "./goe.js";

let goe: Goe;

export async function createImpl(env: NodeJS.ProcessEnv): Promise<Api> {
  // init sdk
  let gitDirCandidate = env['GIT_DIR'];
  if (!gitDirCandidate) {
    gitDirCandidate = '.git';
  }
  const gitdir  = path.resolve(gitDirCandidate);
  const [, , , remoteUrl] = process.argv
  const protocol = await parseGoeURI(remoteUrl);

  const gasIncPct = Number(process.env.GOE_GAS_INC_PCT ?? 10);

  goe = await Goe.create(gitdir, protocol);


  return {
    list: async (forPush) => {
      return await goe.doList(forPush);
    },
    handlePush: async (refs) => {
      return await goe.doPush(refs, gasIncPct);
    },
    handleFetch: async (p) => {
      return await goe.doFetch(p);
    },
    close: async () => {
      await goe.close();
    }
  };
}
