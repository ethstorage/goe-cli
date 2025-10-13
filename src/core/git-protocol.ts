import { createInterface } from 'node:readline';
import { stdout, stderr } from 'node:process';
import { Api, PushRef } from '../types/api-types.js';

const out = (line = '') => stdout.write(line + '\n');

export default async function GitRemoteHelper({ stdin, api }: {
  stdin: NodeJS.ReadStream,
  api: Api
}) {
  // Simpler line-oriented handler to avoid RX runtime dependency in template.
  const rl = createInterface({ input: stdin, crlfDelay: Infinity });
  let readingPush = false;
  const pendingPushes: PushRef[] = [];

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (trimmed === '') {
      if (readingPush) {
        readingPush = false;
        try {
          const res = await api.handlePush(pendingPushes);
          process.stdout.write(res);
        } catch (e) {
          for (const p of pendingPushes) out(`error ${p.dst} "${String(e)}"`);
        } finally {
          pendingPushes.length = 0;
        }
      } else {
        out("");
      }
      return;
    }

    if (trimmed === 'capabilities') {
      out('option');
      out('fetch');
      out('push');
      out('');
      return;
    }

    if (trimmed.startsWith('option')) {
      out('ok');
      return;
    }

    if (trimmed.startsWith('list')) {
      try {
        const res = await api.list(trimmed.includes('for-push'));
        process.stdout.write(res);
      } catch (e) {
        stderr.write(`list failed: ${String(e)}\n`);
        out('');
      }
      return;
    }

    if (trimmed.startsWith('push')) {
      // push lines: "push +refs/heads/master:refs/heads/master" or multiple
      const lineNoCmd = line.slice(5).trim();
      const force = lineNoCmd.startsWith('+');
      const refs = force ? lineNoCmd.slice(1) : lineNoCmd;
      const [src, dst] = refs.split(':');
      pendingPushes.push({ src, dst, force });
      readingPush = true;
      return;
    }

    if (trimmed.startsWith('fetch')) {
      try {
        // parse "fetch <want> <ref>"
        const parts = trimmed.split(' ');
        const want = parts[1];
        const refname = parts.slice(2).join(' ');
        await api.handleFetch([{ref: refname, oid: want}]);
        out('');
      } catch (e) {
        stderr.write(`fetch failed: ${String(e)}\n`);
        out('');
      }
      return;
    }

    // unknown command
    stderr.write('unknown command: ' + line + '\n');
    out('');
  });

  // keep process alive until stdin ends
}
