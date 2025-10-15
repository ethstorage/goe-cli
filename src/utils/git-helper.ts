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

export async function createPackFileBuffer(newOid: string, oldOid?: string): Promise<Buffer> {
  const revs = oldOid ? `${newOid}\n^${oldOid}\n` : `${newOid}\n`;

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = spawn(
        "git",
        ["pack-objects", "--stdout", "--revs", "--thin", "--delta-base-offset"],
        { stdio: ["pipe", "pipe", "inherit"] }
    );

    child.stdout.on("data", (d) => chunks.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`git pack-objects exited with code ${code}`));
      }
    });
    child.stdin.end(Buffer.from(revs, "utf8"));
  });
}

export async function getLocalCommitOids(refName: string): Promise<string[]> {
  const cmd = ["git", "rev-list", "--objects", refName];
  try {
    const output = await runCmdCapture(cmd);

    // Git rev-list --objects output：<OID> [path/to/file]
    const lines = output.trim().split('\n');
    return lines
        .filter(line => line.trim() !== '')
        .map(line => line.split(/\s+/)[0]);
  } catch (error) {
    console.error(`Warning: 'git rev-list --objects ${refName}' failed. Assuming no local objects: ${error}`);
    return [];
  }
}
