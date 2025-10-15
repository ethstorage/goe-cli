import { Api } from '../types/api-types.js';
import { parseEthsURI } from "../utils/index.js";
import Eths from "./eths.js";

let eths: Eths;

export async function createImpl(): Promise<Api> {
  // init sdk
  const [, , , remoteUrl] = process.argv
  const protocol = await parseEthsURI(remoteUrl);

  eths = await Eths.create(protocol);


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
      if (eths && typeof eths.close === 'function') {
        await eths.close();
      }
    }
  };
}
