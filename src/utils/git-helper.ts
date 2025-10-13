import { spawn } from 'node:child_process';
import { tmpdir } from "os";
import { join } from "path";
import fs from "fs";

export function runCmdCapture(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), { stdio: ['ignore','pipe','inherit'] });
    let buf = '';
    child.stdout.on('data', d => buf += d.toString());
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(buf) : reject(new Error('cmd exit ' + code)));
  });
}

export async function createPackFile(newOid: string, oldOid?: string): Promise<{ path: string; size: number }> {
  const revs = oldOid ? `${newOid}\n^${oldOid}\n` : `${newOid}\n`;
  const tmpFile = join(tmpdir(), `pack-${Date.now()}.pack`);
  const out = fs.createWriteStream(tmpFile);

  const child = spawn("git", ["pack-objects", "--stdout", "--revs", "--thin", "--delta-base-offset"], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  child.stdout.pipe(out);
  child.stdin.end(Buffer.from(revs, "utf8"));

  await new Promise<void>((resolve, reject) => {
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pack-objects failed ${code}`));
    });
  });

  const { size } = fs.statSync(tmpFile);
  return { path: tmpFile, size };
}

export function runGitIndexPackFromBuf(buf: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['index-pack','--stdin','--fix-thin','--keep','-v'], { stdio: ['pipe','inherit','inherit'] });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error('index-pack exit ' + code)));
    child.stdin.end(buf);
  });
}
