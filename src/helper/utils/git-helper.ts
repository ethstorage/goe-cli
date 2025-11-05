import { spawn, SpawnOptions } from 'node:child_process';
import { createReadStream } from 'node:fs';
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import os from "os";

import { PackCreationResult, PackFileChunk } from "../types/index.js";
import { log } from "./log.js";

function spawnWithOutput(
    command: string,
    args: string[],
    options: SpawnOptions,
    input?: string | Buffer
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    const chunks: Buffer[] = [];

    if (!child.stdout) return reject(new Error(`stdout not piped for ${command}`));
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`Command "${command} ${args.join(' ')}" exited ${code ?? signal}`));
    });

    if (child.stdin && input) child.stdin.end(input);
  });
}

function spawnNoOutput(
    command: string,
    args: string[],
    options: SpawnOptions = {},
    input?: string | Buffer
): Promise<void> {
  const adjusted: SpawnOptions = {
    ...options,
    stdio: options.stdio ?? ['pipe', 'ignore', 'inherit'],
  };

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, adjusted);
    child.on('error', reject);
    child.on('close', (code, signal) =>
        code === 0 ? resolve() : reject(new Error(`Command "${command} ${args.join(' ')}" exited ${code ?? signal}`))
    );
    if (input && child.stdin) child.stdin.end(input);
  });
}

async function runCmdCapture(args: string[], gitdir: string): Promise<string> {
  const buf = await spawnWithOutput(args[0], args.slice(1), { cwd: path.dirname(gitdir), stdio: ['pipe','pipe','inherit'] });
  return buf.toString('utf8');
}

// --- Git Tool Functions ---
async function runGitIndexPackFromFile(packFilePath: string, gitdir: string): Promise<void> {
  return spawnNoOutput(
      'git',
      ['index-pack', '--keep', '-v', packFilePath],
      { cwd: path.dirname(gitdir), stdio: ['ignore', 'ignore', 'inherit'] }
  );
}

export async function runGitPackFromFile(packFilePath: string, gitdir: string): Promise<void> {
  try {
    await runGitIndexPackFromFile(packFilePath, gitdir);
  } catch (err) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('git', ['index-pack', '--fix-thin', '--stdin', '-v'], {
        cwd: path.dirname(gitdir),
        stdio: ['pipe', 'inherit', 'pipe']
      });
      const stderr: Buffer[] = [];
      if (child.stderr) child.stderr.on('data', d => stderr.push(d));
      child.on('error', reject);
      child.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`git index-pack --fix-thin failed: ${Buffer.concat(stderr).toString()}`));
      });

      createReadStream(packFilePath).pipe(child.stdin!);
    });
  }
}

export async function getLocalCommitOids(refName: string, gitdir: string): Promise<Set<string>> {
  try {
    await spawnNoOutput('git', ['show-ref', '--quiet', '--verify', refName]);
  } catch {
    return new Set();
  }

  try {
    const output = await runCmdCapture(['git', 'rev-list', refName], gitdir);
    return new Set(output.trim().split('\n').filter(Boolean));
  } catch (err) {
    log(`Warning: 'git rev-list ${refName}' failed: ${err}`);
    return new Set();
  }
}

export async function getOidFromRef(refName: string, gitdir: string): Promise<string> {
  const args = ["git", "rev-parse", refName];
  const output = await runCmdCapture(args, gitdir);
  return output.trim();
}

export async function findMatchingLocalBranch(remoteRef: string, gitdir: string): Promise<string | null> {
  try {
    await runCmdCapture(['git', 'rev-parse', '--is-inside-work-tree'], gitdir);
  } catch (err) {
    return null;
  }
  try {
    const branchConfigs = await runCmdCapture(['git', 'config', '--get-regexp', '^branch\\.'], gitdir);
    if (!branchConfigs.trim()) {
      return null;
    }
  } catch (err) {
    return null;
  }

  // query
  let remote = 'origin';
  let branchName: string;

  const remotesMatch = remoteRef.match(/^refs\/remotes\/([^/]+)\/(.+)$/);
  if (remotesMatch) {
    [, remote, branchName] = remotesMatch;
  } else if (remoteRef.startsWith('refs/heads/')) {
    branchName = remoteRef.replace('refs/heads/', '');
  } else {
    const parts = remoteRef.split('/');
    if (parts.length >= 2) {
      remote = parts[0];
      branchName = parts.slice(1).join('/');
    } else {
      return null;
    }
  }
  const mergeRef = `refs/heads/${branchName}`;
  let configOutput: string;
  try {
    configOutput = await runCmdCapture(['git', 'config', '--list'], gitdir);
  } catch (err) {
    return null;
  }

  const branchConfig: Record<string, { remote?: string; merge?: string }> = {};
  for (const line of configOutput.trim().split('\n')) {
    const [key, val] = line.split('=');
    if (!key || !val) continue;
    const match = key.match(/^branch\.(.+?)\.(remote|merge)$/);
    if (match) {
      const [, branch, prop] = match;
      branchConfig[branch] ||= {};
      (branchConfig[branch] as any)[prop] = val.trim();
    }
  }

  let currentBranch: string | null = null;
  try {
    const output = (await runCmdCapture(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], gitdir)).trim();
    if (output && output !== 'HEAD') {
      currentBranch = output;
    }
  } catch {
    currentBranch = null;
  }

  if (currentBranch) {
    const currentConf = branchConfig[currentBranch];
    if (currentConf?.remote === remote && currentConf?.merge === mergeRef) {
      return `refs/heads/${currentBranch}`;
    }
  }

  for (const [branch, { remote: r, merge: m }] of Object.entries(branchConfig)) {
    if (r === remote && m === mergeRef) {
      return `refs/heads/${branch}`;
    }
  }

  return null;
}


// =======================Create Packfiles=========================================
async function parentExistsOnBranch(parentOid: string, branchRef: string, gitdir: string): Promise<boolean> {
  try {
    await spawnNoOutput('git', ['merge-base', '--is-ancestor', parentOid, branchRef], { cwd: path.dirname(gitdir) });
    return true;
  } catch (e) {
    return false;
  }
}

// Get all commits between parent and newOid
async function getAllCommits(newOid: string, parentOid: string | null, gitdir: string): Promise<string[]> {
  const args = ['git', 'rev-list', '--topo-order', '--reverse', newOid];
  if (parentOid) args.push(`^${parentOid}`);
  const out = await runCmdCapture(args, gitdir);
  return out.trim().split(/\s+/).filter(Boolean);
}

// Create pack for given commit range
async function createPackForRange(
    endOid: string,
    parentOid: string | null,
    gitdir: string
): Promise<Buffer> {
  const revs = parentOid ? `${endOid}\n^${parentOid}\n` : `${endOid}\n`;
  return await spawnWithOutput(
      'git',
      ['pack-objects', '--stdout', '--revs', '--thin', '--delta-base-offset', '--quiet'],
      { cwd: path.dirname(gitdir), stdio: ['pipe', 'pipe', 'pipe'] },
      Buffer.from(revs, 'utf8')
  );
}

async function saveFile(packDir: string, buf: Buffer): Promise<string> {
  const prefix = `pack_${uuidv4().replace(/-/g, '')}`;
  const outputBase = path.join(packDir, prefix);
  const packPath = `${outputBase}.pack`;
  await fs.writeFile(packPath, buf);
  return packPath;
}

// Binary search approach for when exponential fails
async function binarySearchApproach(
    commits: string[],
    parentOid: string | null,
    maxSizeBytes: number,
    tempPackDir: string,
    gitdir: string
): Promise<PackCreationResult> {
  const MIN_SIZE_THRESHOLD = maxSizeBytes * 0.5;
  const chunks: PackFileChunk[] = [];
  let currentParent = parentOid;
  let idx = 0;

  while (idx < commits.length) {
    let left = idx;
    let right = commits.length - 1;
    let best = idx;

    // Quick check: can we take all remaining?
    try {
      const packBuffer = await createPackForRange(commits[right], currentParent, gitdir);
      if (packBuffer.length <= maxSizeBytes) {
        const packfilePath = await saveFile(tempPackDir, packBuffer);
        chunks.push({
          path: packfilePath,
          size: packBuffer.length,
          startOid: currentParent ?? '',
          endOid: commits[right]
        });
        break;
      }
    } catch {}

    // Binary search for optimal range
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      try {
        const packBuffer = await createPackForRange(commits[mid], currentParent, gitdir);
        if (packBuffer.length <= maxSizeBytes) {
          best = mid;
          left = mid + 1;
        } else {
          right = mid - 1;
        }
      } catch {
        right = mid - 1;
      }
    }

    // Create final pack for the best range found
    let packBuffer = await createPackForRange(commits[best], currentParent, gitdir);
    if (packBuffer.length < MIN_SIZE_THRESHOLD && best + 1 < commits.length) {
      const nextBestIndex = best + 1;
      const nextEndOid = commits[nextBestIndex];
      try {
        packBuffer = await createPackForRange(nextEndOid, currentParent, gitdir);
        best = nextBestIndex;
      } catch {}
    }

    const packfilePath = await saveFile(tempPackDir, packBuffer);
    chunks.push({
      path: packfilePath,
      size: packBuffer.length,
      startOid: currentParent ?? '',
      endOid: commits[best]
    });

    currentParent = commits[best];
    idx = best + 1;
  }

  return { chunks, tempDir: tempPackDir };
}

// Adaptive algorithm that starts fast and gets smarter as needed
export async function createCommitBoundaryPacks(
    branchRef: string,
    newOid: string,
    parentOid: string | null,
    gitdir: string,
    maxSizeBytes: number = 10 * 1024 * 1024
): Promise<PackCreationResult> {
  const tempPackDir = path.join(os.tmpdir(), `eths-adaptive-${uuidv4().substring(0, 8)}`);
  await fs.mkdir(tempPackDir, { recursive: true });

  try {
    let validParent = parentOid;
    if (parentOid && !(await parentExistsOnBranch(parentOid, branchRef, gitdir))) {
      log(`[warn] parentOid ${parentOid} not found locally, ignoring`);
      validParent = null;
    }

    const commits = await getAllCommits(newOid, validParent, gitdir);
    if (!commits.length) return { chunks: [], tempDir: tempPackDir };

    // Phase 1: Quick assessment - try to pack everything first
    if (commits.length <= 10) {
      // For very small number of commits, just pack everything
      const packBuffer = await createPackForRange(commits[commits.length - 1], validParent, gitdir);
      if (packBuffer.length <= maxSizeBytes) {
        const packfilePath = await saveFile(tempPackDir, packBuffer);
        return {
          chunks: [{ path: packfilePath, size: packBuffer.length, startOid: validParent ?? "", endOid: commits[commits.length - 1] }],
          tempDir: tempPackDir,
        };
      }
    }

    // Phase 3: Fall back to binary search for large/complex repos
    return await binarySearchApproach(commits, validParent, maxSizeBytes, tempPackDir, gitdir);
  } catch (err) {
    await fs.rm(tempPackDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}
