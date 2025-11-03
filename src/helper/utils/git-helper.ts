import { spawn, SpawnOptions } from 'node:child_process';
import { createReadStream } from 'node:fs';
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { join } from "path";
import fs from "fs/promises";
import os from "os";
import pLimit from "p-limit";

import { PackCreationResult, PackFileChunk } from "../types/index.js";

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

    if (child.stdin) child.stdin.end(input);
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
    if (child.stdin) child.stdin.end(input);
  });
}

async function runCmdCapture(args: string[]): Promise<string> {
  const buf = await spawnWithOutput(args[0], args.slice(1), { stdio: ['ignore', 'pipe', 'inherit'] });
  return buf.toString('utf8');
}

// --- Git Tool Functions ---
async function runGitIndexPackFromFile(packFilePath: string, gitDir: string): Promise<void> {
  return spawnNoOutput(
      'git',
      ['index-pack', '--keep', '-v', packFilePath],
      { cwd: path.dirname(gitDir), stdio: ['ignore', 'ignore', 'inherit'] }
  );
}

export async function runGitPackFromFile(packFilePath: string, gitDir: string): Promise<void> {
  try {
    await runGitIndexPackFromFile(packFilePath, gitDir);
  } catch (err) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('git', ['index-pack', '--fix-thin', '--stdin', '-v'], {
        cwd: path.dirname(gitDir),
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

export async function getLocalCommitOids(refName: string): Promise<Set<string>> {
  try {
    await spawnNoOutput('git', ['show-ref', '--quiet', '--verify', refName]);
  } catch {
    return new Set();
  }

  try {
    const output = await runCmdCapture(['git', 'rev-list', refName]);
    return new Set(output.trim().split('\n').filter(Boolean));
  } catch (err) {
    console.error(`Warning: 'git rev-list ${refName}' failed: ${err}`);
    return new Set();
  }
}

export async function getOidFromRef(refName: string): Promise<string> {
  const args = ["git", "rev-parse", refName];
  const output = await runCmdCapture(args);
  return output.trim();
}

export async function findMatchingLocalBranch(remoteRef: string): Promise<string | null> {
  try {
    await runCmdCapture(['git', 'rev-parse', '--is-inside-work-tree']);
  } catch (err) {
    return null;
  }
  try {
    const branchConfigs = await runCmdCapture(['git', 'config', '--get-regexp', '^branch\\.']);
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
    configOutput = await runCmdCapture(['git', 'config', '--list']);
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
    const output = (await runCmdCapture(['git', 'rev-parse', '--abbrev-ref', 'HEAD'])).trim();
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
// Helper: run git and collect stdout
// run git and get string
async function execGit(args: string[], gitdir: string): Promise<string> {
  const buf = await spawnWithOutput('git', args, { cwd: path.dirname(gitdir), stdio: ['pipe','pipe','inherit'] });
  return buf.toString('utf8');
}

// Get all commits between parent and newOid
async function getAllCommits(newOid: string, parentOid: string | null, gitdir: string): Promise<string[]> {
  const args = ['rev-list', '--topo-order', '--reverse', newOid];
  if (parentOid) args.push(`^${parentOid}`);
  const out = await execGit(args, gitdir);
  return out.trim().split(/\s+/).filter(Boolean);
}

// Estimate commit sizes
async function estimateCommitSizes(parentOid: string | null, commits: string[], gitdir: string, defaultBytes = 50): Promise<number[]> {
  if (commits.length === 0) return [];
  let range: string;
  if (commits.length === 1) {
    range = commits[0];
  } else {
    const first = commits[0];
    range = parentOid ? `${first}^..${commits[commits.length - 1]}` : `${first}..${commits[commits.length - 1]}`;
  }

  let out: string;
  try {
    out = await execGit(['log', '--format=%H', '--no-renames', '--numstat', range], gitdir);
  } catch {
    return commits.map(() => 1024);
  }

  const lines = out.split('\n');
  const map = new Map<string, number>();
  let currentHash: string | null = null;

  for (const line of lines) {
    if (!line) continue;
    if (/^[0-9a-f]{7,40}$/.test(line)) {
      currentHash = line.trim();
      map.set(currentHash, 0);
    } else {
      const parts = line.split('\t');
      if (parts.length >= 3 && currentHash) {
        const added = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
        const deleted = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
        const linesChanged = added + deleted;
        const prev = map.get(currentHash) || 0;
        map.set(currentHash, prev + linesChanged * defaultBytes);
      }
    }
  }

  return commits.map(c => map.get(c) ?? Math.max(1024, defaultBytes * 2));
}

// Create pack for given commit range
async function createPackForRange(
    endOid: string,
    parentOid: string | null,
    packDir: string,
    gitdir: string
): Promise<{ path: string; size: number }> {
  const prefix = `pack_${uuidv4().replace(/-/g, '')}`;
  const outputBase = join(packDir, prefix);

  const revs = parentOid ? `${endOid}\n^${parentOid}\n` : `${endOid}\n`;
  const buf = await spawnWithOutput(
      'git',
      ['pack-objects', '--stdout', '--revs', '--thin', '--delta-base-offset', '--quiet'],
      { cwd: path.dirname(gitdir), stdio: ['pipe', 'pipe', 'pipe'] },
      Buffer.from(revs, 'utf8')
  );

  const packPath = `${outputBase}.pack`;
  await fs.writeFile(packPath, buf);
  return { path: packPath, size: buf.length };
}

export async function createCommitBoundaryPacks(
    newOid: string,
    parentOid: string | null,
    gitdir: string,
    maxSizeBytes: number = 15 * 1024 * 1024
): Promise<PackCreationResult> {
  const chunks: PackFileChunk[] = [];
  const tempPackDir = join(os.tmpdir(), `eths-packs-${uuidv4().substring(0, 8)}`);
  await fs.mkdir(tempPackDir, { recursive: true });

  const concurrency = Math.min(os.cpus().length, 4);
  const limit = pLimit(concurrency);

  try {
    const commits = await getAllCommits(newOid, parentOid, gitdir);
    if (commits.length === 0) return {chunks: [], tempDir: ""};

    let estimates = await estimateCommitSizes(parentOid, commits, gitdir);
    let correctionFactor = 0.2;
    const emaAlpha = 0.25;

    const prefixSum = new Array(estimates.length + 1);
    prefixSum[0] = 0;
    for (let i = 0; i < estimates.length; i++) prefixSum[i + 1] = prefixSum[i] + estimates[i];
    const rangeSum = (i: number, j: number) => prefixSum[j + 1] - prefixSum[i];

    let idx = 0;
    let currentParent = parentOid;

    while (idx < commits.length) {
      let cumulative = 0;
      let candidate = idx;
      const safety = 1.4;
      while (candidate < commits.length) {
        cumulative += estimates[candidate];
        if (cumulative * correctionFactor > maxSizeBytes * safety) break;
        candidate++;
      }
      candidate = candidate === idx ? idx : candidate - 1;

      let left = idx;
      let right = Math.min(candidate, commits.length - 1);
      let best = idx;
      let lastPackResult: { path: string; size: number } | null = null;
      const tempPacksToClean: Array<{ pack: string }> = [];

      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const trialOid = commits[mid];
        const trialPackPromise = limit(() => createPackForRange(trialOid, currentParent, tempPackDir, gitdir));

        try {
          const trialPack = await trialPackPromise;
          tempPacksToClean.push({ pack: trialPack.path });
          if (trialPack.size <= maxSizeBytes) {
            best = mid;
            lastPackResult = trialPack;
            left = mid + 1;
          } else {
            right = mid - 1;
          }
        } catch {
          right = mid - 1;
        }
      }

      if (!lastPackResult || best < idx) {
        await Promise.all(tempPacksToClean.map(p =>
            Promise.all([fs.rm(p.pack, { force: true })])
        ));
        lastPackResult = await createPackForRange(commits[idx], currentParent, tempPackDir, gitdir);
        best = idx;
      }

      if (lastPackResult && lastPackResult.size > maxSizeBytes) {
        await Promise.all(tempPacksToClean.map(p =>
            Promise.all([fs.rm(p.pack, { force: true })])
        ));
        await fs.rm(lastPackResult.path, { force: true });
        lastPackResult = await createPackForRange(commits[best], currentParent, tempPackDir, gitdir);
      } else if (lastPackResult) {
        await Promise.all(tempPacksToClean.map(p =>
            Promise.all([fs.rm(p.pack, { force: true })])
        ));
        const recreatedPack = await createPackForRange(commits[best], currentParent, tempPackDir, gitdir);
        await fs.rm(lastPackResult.path, { force: true });
        lastPackResult = recreatedPack;
      }

      const finalPack = lastPackResult!;
      chunks.push({
        path: finalPack.path,
        size: finalPack.size,
        startOid: currentParent ?? '',
        endOid: commits[best]
      });

      const estSum = rangeSum(idx, best);
      if (estSum > 0) {
        const observedRatio = finalPack.size / estSum;
        if (Number.isFinite(observedRatio) && observedRatio > 0) {
          correctionFactor = emaAlpha * observedRatio + (1 - emaAlpha) * correctionFactor;
        }
      }

      currentParent = commits[best];
      idx = best + 1;
    }
    return { chunks: chunks, tempDir: tempPackDir };
  } catch (err) {
    await fs.rm(tempPackDir, { recursive: true, force: true });
    throw err;
  }
}
