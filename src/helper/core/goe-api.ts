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

  const gasIncPct = getGasIncPct();

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

function getGasIncPct(): number {
  const envKeys = Object.keys(process.env);

  const patterns = [
    /^GOE?_?GAS(_INC)?_?PCT$/i,   // GOE_GAS_INC_PCT, GOE_GAS_PCT, GAS_INC_PCT, GAS_PCT
    /^GOE?_?INC_?GAS$/i,           // GOE_INC_GAS, INC_GAS
  ];

  for (const pattern of patterns) {
    const key = envKeys.find(k => pattern.test(k));
    if (key) {
      const value = process.env[key];
      if (value) {
        const n = Number(value);
        if (!isNaN(n)) return n;
      }
    }
  }
  return 1;
}
