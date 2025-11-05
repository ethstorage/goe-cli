import { spawn, SpawnOptions } from 'node:child_process';
import { createReadStream } from 'node:fs';
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { join } from "path";
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
    log(`Warning: 'git rev-list ${refName}' failed: ${err}`);
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

// Exponential growing: try 1, 2, 4, 8... commits until we exceed limit, then binary search in that range
async function tryExponentialApproach(
    commits: string[],
    parentOid: string | null,
    maxSizeBytes: number,
    tempPackDir: string,
    gitdir: string
): Promise<{ success: boolean; chunks: PackFileChunk[] }> {
  const chunks: PackFileChunk[] = [];
  let currentParent = parentOid;
  let idx = 0;
  let consecutiveFailures = 0;
  const maxFailures = 3; // If we fail too many times, abort this approach

  while (idx < commits.length) {
    let step = 1;
    let lastValidEnd = idx;
    let lastValidPack: { path: string; size: number } | null = null;

    // Exponential growth phase
    while (idx + step <= commits.length && consecutiveFailures < maxFailures) {
      const endIdx = idx + step - 1;
      try {
        const trialPack = await createPackForRange(commits[endIdx], currentParent, tempPackDir, gitdir);

        if (trialPack.size <= maxSizeBytes) {
          lastValidEnd = endIdx;
          lastValidPack = trialPack;
          step *= 2;
          consecutiveFailures = 0; // Reset failure counter on success
        } else {
          await fs.rm(trialPack.path, { force: true });
          consecutiveFailures++;
          break;
        }
      } catch (error) {
        consecutiveFailures++;
        break;
      }
    }

    if (lastValidPack && lastValidEnd >= idx) {
      // We found a valid range, use it
      chunks.push({
        path: lastValidPack.path,
        size: lastValidPack.size,
        startOid: currentParent ?? '',
        endOid: commits[lastValidEnd]
      });

      currentParent = commits[lastValidEnd];
      idx = lastValidEnd + 1;
    } else if (consecutiveFailures >= maxFailures) {
      // Too many failures, abort exponential approach
      // Clean up any packs we created
      for (const chunk of chunks) {
        await fs.rm(chunk.path, { force: true }).catch(() => {});
      }
      return { success: false, chunks };
    } else {
      // Single commit approach as fallback
      const singlePack = await createPackForRange(commits[idx], currentParent, tempPackDir, gitdir);
      chunks.push({
        path: singlePack.path,
        size: singlePack.size,
        startOid: currentParent ?? '',
        endOid: commits[idx]
      });
      currentParent = commits[idx];
      idx++;
    }
  }

  return { success: true, chunks };
}

// Binary search approach for when exponential fails
async function binarySearchApproach(
    commits: string[],
    parentOid: string | null,
    maxSizeBytes: number,
    tempPackDir: string,
    gitdir: string
): Promise<PackCreationResult> {
  const chunks: PackFileChunk[] = [];
  let currentParent = parentOid;
  let idx = 0;

  while (idx < commits.length) {
    let left = idx;
    let right = commits.length - 1;
    let best = idx;

    // Quick check: can we take all remaining?
    try {
      const fullPack = await createPackForRange(commits[right], currentParent, tempPackDir, gitdir);
      if (fullPack.size <= maxSizeBytes) {
        chunks.push({
          path: fullPack.path,
          size: fullPack.size,
          startOid: currentParent ?? '',
          endOid: commits[right]
        });
        break;
      }
      await fs.rm(fullPack.path, { force: true });
    } catch (error) {
      // Continue with binary search
    }

    // Binary search for optimal range
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      try {
        const trialPack = await createPackForRange(commits[mid], currentParent, tempPackDir, gitdir);

        if (trialPack.size <= maxSizeBytes) {
          best = mid;
          left = mid + 1;

          // Early exit if we're close to limit
          if (trialPack.size > maxSizeBytes * 0.9) {
            await fs.rm(trialPack.path, { force: true });
            break;
          }
          await fs.rm(trialPack.path, { force: true });
        } else {
          right = mid - 1;
          await fs.rm(trialPack.path, { force: true });
        }
      } catch (error) {
        right = mid - 1;
      }
    }

    // Create final pack for the best range found
    const finalPack = await createPackForRange(commits[best], currentParent, tempPackDir, gitdir);
    chunks.push({
      path: finalPack.path,
      size: finalPack.size,
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
    newOid: string,
    parentOid: string | null,
    gitdir: string,
    maxSizeBytes: number = 15 * 1024 * 1024
): Promise<PackCreationResult> {
  const chunks: PackFileChunk[] = [];
  const tempPackDir = path.join(os.tmpdir(), `eths-adaptive-${uuidv4().substring(0, 8)}`);
  await fs.mkdir(tempPackDir, { recursive: true });

  try {
    const commits = await getAllCommits(newOid, parentOid, gitdir);
    if (commits.length === 0) {
      return { chunks: [], tempDir: tempPackDir };
    }

    // Phase 1: Quick assessment - try to pack everything first
    if (commits.length <= 10) {
      // For very small number of commits, just pack everything
      const fullPack = await createPackForRange(commits[commits.length - 1], parentOid, tempPackDir, gitdir);
      if (fullPack.size <= maxSizeBytes) {
        chunks.push({
          path: fullPack.path,
          size: fullPack.size,
          startOid: parentOid ?? '',
          endOid: commits[commits.length - 1]
        });
        return { chunks, tempDir: tempPackDir };
      }
    }

    // Phase 2: Try exponential growing approach first (fast for small-to-medium repos)
    let result = await tryExponentialApproach(commits, parentOid, maxSizeBytes, tempPackDir, gitdir);
    if (result.success) {
      return { chunks: result.chunks, tempDir: tempPackDir };
    }

    // Phase 3: Fall back to binary search for large/complex repos
    console.log(`Exponential approach failed, falling back to binary search`);
    return await binarySearchApproach(commits, parentOid, maxSizeBytes, tempPackDir, gitdir);
  } catch (error) {
    await fs.rm(tempPackDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
