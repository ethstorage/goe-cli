import { spawn, SpawnOptions } from 'node:child_process';
import { createReadStream } from 'node:fs';
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import os from "os";

// Assuming these types and log module exist in your project
import { PackCreationResult, PackFileChunk } from "../types/index.js";
import { log } from "./log.js";

// --- Helper Constants ---
const MAX_PACK_SIZE_DEFAULT = 10 * 1024 * 1024; // 10MB

// --- 1. General Process Execution Utilities ---

/**
 * Determines the Current Working Directory (CWD) for Git commands.
 * Assumes gitdir is the path to the .git directory; commands should run in the parent directory.
 * @param gitdir Path to the .git directory.
 * @returns The CWD for the command execution.
 */
function getCwd(gitdir: string): string {
  return path.dirname(gitdir);
}

/**
 * Executes a command and captures its standard output.
 * @param command The command to execute (e.g., 'git').
 * @param args List of arguments.
 * @param options SpawnOptions.
 * @param input Optional input to pipe to stdin.
 * @returns Promise<Buffer> A buffer containing the standard output.
 */
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
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        const fullCommand = `"${command} ${args.join(' ')}"`;
        reject(new Error(`Command ${fullCommand} exited ${code ?? signal}`));
      }
    });

    if (child.stdin && input) child.stdin.end(input);
    else if (child.stdin) child.stdin.end(); // Ensure stdin is closed even if no input
  });
}

/**
 * Executes a command, ignoring its standard output.
 * @param command The command to execute (e.g., 'git').
 * @param args List of arguments.
 * @param options SpawnOptions (default stdio: ['pipe', 'ignore', 'inherit']).
 * @param input Optional input to pipe to stdin.
 * @returns Promise<void>
 */
function spawnNoOutput(
    command: string,
    args: string[],
    options: SpawnOptions = {},
    input?: string | Buffer
): Promise<void> {
  const adjusted: SpawnOptions = {
    ...options,
    // Default: stdin pipe, stdout ignore, stderr inherit
    stdio: options.stdio ?? ['pipe', 'ignore', 'inherit'],
  };

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, adjusted);
    child.on('error', reject);
    child.on('close', (code, signal) =>
        code === 0 ? resolve() : reject(new Error(`Command "${command} ${args.join(' ')}" exited ${code ?? signal}`))
    );
    if (input && child.stdin) child.stdin.end(input);
    else if (child.stdin) child.stdin.end();
  });
}

// --- 2. Core Git Command Wrappers ---

/**
 * Executes a Git command and captures its standard output.
 * @param args Git command arguments (e.g., ['rev-list', 'HEAD']).
 * @param gitdir Path to the .git directory.
 * @returns Promise<string> The trimmed standard output.
 */
async function gitRunCapture(args: string[], gitdir: string): Promise<string> {
  const cwd = getCwd(gitdir);
  const buf = await spawnWithOutput('git', args, { cwd, stdio: ['pipe', 'pipe', 'inherit'] });
  return buf.toString('utf8').trim();
}

/**
 * Executes a Git command, ignoring its standard output.
 * @param args Git command arguments.
 * @param gitdir Path to the .git directory.
 * @returns Promise<void>
 */
async function gitRunNoOutput(args: string[], gitdir: string): Promise<void> {
  const cwd = getCwd(gitdir);
  await spawnNoOutput('git', args, { cwd });
}

async function gitRunNoOutputIgnore(args: string[], gitdir: string): Promise<void> {
  const cwd = getCwd(gitdir);
  await spawnNoOutput('git', args, { cwd, stdio: ['pipe', 'ignore', 'ignore'] });
}

// --- 3. Git Tool Functions (Using Core Wrappers) ---

/**
 * Runs `git index-pack` to import a pack file into the repository.
 * Tries with `--keep` first, and falls back to piping with `--fix-thin` on failure.
 * @param packFilePath Path to the pack file.
 * @param gitdir Path to the .git directory.
 */
export async function runGitPackFromFile(packFilePath: string, gitdir: string): Promise<void> {
  const cwd = getCwd(gitdir);
  try {
    // Attempt standard index-pack with --keep
    await gitRunNoOutputIgnore(
        ['index-pack', '--keep', packFilePath],
        gitdir
    );
  } catch (err: any) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('git', ['index-pack', '--fix-thin', '--stdin', '-v'], { cwd, stdio: ['pipe', 'ignore', 'pipe'] });
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

/**
 * Gets all commit OIDs under a specified ref.
 * @param refName Branch or tag name (e.g., 'refs/heads/main').
 * @param gitdir Path to the .git directory.
 * @returns Promise<Set<string>> A set of commit OIDs.
 */
export async function getLocalCommitOids(refName: string, gitdir: string): Promise<Set<string>> {
  try {
    // Check if ref exists
    await gitRunNoOutput(['show-ref', '--quiet', '--verify', refName], gitdir);
  } catch {
    return new Set();
  }

  try {
    const output = await gitRunCapture(['rev-list', refName], gitdir);
    // gitRunCapture result is already trimmed
    return new Set(output.split('\n').filter(Boolean));
  } catch (err: any) {
    log(`[warn] 'git rev-list ${refName}' failed: ${err.message}`);
    return new Set();
  }
}

/**
 * Gets the OID for a specified ref.
 * @param refName Branch or tag name.
 * @param gitdir Path to the .git directory.
 * @returns Promise<string> The OID.
 */
export async function getOidFromRef(refName: string, gitdir: string): Promise<string> {
  return gitRunCapture(["rev-parse", refName], gitdir);
}

/**
 * Finds a local tracking branch that matches a remote ref based on git configuration.
 * @param remoteRef Remote ref (e.g., 'refs/remotes/origin/main').
 * @param gitdir Path to the .git directory.
 * @returns Promise<string | null> The local ref (e.g., 'refs/heads/main') or null.
 */
export async function findMatchingLocalBranch(remoteRef: string, gitdir: string): Promise<string | null> {
  try {
    // Check if inside a work tree
    await gitRunNoOutput(['rev-parse', '--is-inside-work-tree'], gitdir);
  } catch {
    return null;
  }
  // Check if branch configs exist
  try {
    await gitRunCapture(['config', '--get-regexp', '^branch\\.'], gitdir);
  } catch {
    return null;
  }

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
    configOutput = await gitRunCapture(['config', '--list'], gitdir);
  } catch {
    return null;
  }

  const branchConfig: Record<string, { remote?: string; merge?: string }> = {};
  for (const line of configOutput.split('\n')) {
    const equalsIndex = line.indexOf('=');
    if (equalsIndex === -1) continue;

    const key = line.substring(0, equalsIndex);
    const val = line.substring(equalsIndex + 1);

    const match = key.match(/^branch\.(.+?)\.(remote|merge)$/);
    if (match) {
      const [, branch, prop] = match;
      branchConfig[branch] ||= {};
      (branchConfig[branch] as any)[prop] = val.trim();
    }
  }

  let currentBranch: string | null = null;
  try {
    const output = await gitRunCapture(['rev-parse', '--abbrev-ref', 'HEAD'], gitdir);
    if (output && output !== 'HEAD') {
      currentBranch = output;
    }
  } catch {
    currentBranch = null;
  }

  // 1. Check current branch first
  if (currentBranch) {
    const currentConf = branchConfig[currentBranch];
    if (currentConf?.remote === remote && currentConf?.merge === mergeRef) {
      return `refs/heads/${currentBranch}`;
    }
  }

  // 2. Iterate through all other branches
  for (const [branch, { remote: r, merge: m }] of Object.entries(branchConfig)) {
    if (r === remote && m === mergeRef) {
      return `refs/heads/${branch}`;
    }
  }

  return null;
}

// ======================= 4. Packfile Creation Utilities =========================================

/**
 * Checks if a parentOid is an ancestor of a branchRef using `git merge-base --is-ancestor`.
 * @param parentOid The potential ancestor OID.
 * @param branchRef The branch reference.
 * @param gitdir Path to the .git directory.
 * @returns Promise<boolean> True if the parent is an ancestor, false otherwise.
 */
async function gitParentExistsOnBranch(parentOid: string, branchRef: string, gitdir: string): Promise<boolean> {
  try {
    await gitRunNoOutput(['merge-base', '--is-ancestor', parentOid, branchRef], gitdir);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Gets all commit OIDs within a range [parentOid exclusion..newOid inclusion].
 * @param newOid The ending OID of the range (inclusive).
 * @param parentOid The starting OID of the range (exclusive, can be null).
 * @param gitdir Path to the .git directory.
 * @returns Promise<string[]> List of OIDs (in reverse topological order).
 */
async function gitGetAllCommits(newOid: string, parentOid: string | null, gitdir: string): Promise<string[]> {
  const args = ['rev-list', '--topo-order', '--reverse', newOid];
  if (parentOid) args.push(`^${parentOid}`);

  const out = await gitRunCapture(args, gitdir);
  return out.split(/\s+/).filter(Boolean); // gitRunCapture result is already trimmed
}

/**
 * Creates a pack file Buffer for the given commit range.
 * @param endOid The ending OID of the range.
 * @param parentOid The starting OID of the range (can be null).
 * @param gitdir Path to the .git directory.
 * @returns Promise<Buffer> The pack file content.
 */
async function gitCreatePackForRange(
    endOid: string,
    parentOid: string | null,
    gitdir: string
): Promise<Buffer> {
  const revs = parentOid ? `${endOid}\n^${parentOid}\n` : `${endOid}\n`;
  const args = ['pack-objects', '--stdout', '--revs', '--thin', '--delta-base-offset', '--quiet'];

  const cwd = getCwd(gitdir);
  return await spawnWithOutput(
      'git',
      args,
      { cwd, stdio: ['pipe', 'pipe', 'pipe'] },
      Buffer.from(revs, 'utf8')
  );
}

/**
 * Saves a Buffer to a temporary pack file.
 * @param packDir The temporary directory path.
 * @param buf The pack file content buffer.
 * @returns Promise<string> The path to the saved pack file.
 */
async function savePackFile(packDir: string, buf: Buffer): Promise<string> {
  const prefix = `pack_${uuidv4().replace(/-/g, '')}`;
  const outputBase = path.join(packDir, prefix);
  const packPath = `${outputBase}.pack`;
  await fs.writeFile(packPath, buf);
  return packPath;
}

/**
 * Uses a binary search approach to split the commit list into pack files
 * that respect the maximum size limit.
 * @param commits The list of commit OIDs.
 * @param parentOid The OID where the chunking starts (exclusive).
 * @param maxSizeBytes Maximum size allowed per pack file.
 * @param tempPackDir Temporary directory for saving packs.
 * @param gitdir Path to the .git directory.
 * @returns Promise<PackCreationResult> Pack file chunk information.
 */
async function binarySearchPackCreation(
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

    // 1. Quick check: try to pack all remaining commits
    try {
      const packBuffer = await gitCreatePackForRange(commits[right], currentParent, gitdir);
      if (packBuffer.length <= maxSizeBytes) {
        const packfilePath = await savePackFile(tempPackDir, packBuffer);
        chunks.push({
          path: packfilePath,
          size: packBuffer.length,
          startOid: currentParent ?? '',
          endOid: commits[right]
        });
        break; // Done
      }
    } catch {}

    // 2. Binary search for the optimal range endpoint
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      try {
        const packBuffer = await gitCreatePackForRange(commits[mid], currentParent, gitdir);
        if (packBuffer.length <= maxSizeBytes) {
          best = mid; // Valid candidate
          left = mid + 1; // Try larger range
        } else {
          right = mid - 1; // Range too large
        }
      } catch {
        right = mid - 1; // Command failed (e.g., OOM), try smaller range
      }
    }

    // 3. Create the final pack, try to merge one more commit to meet minimum size threshold
    let packBuffer = await gitCreatePackForRange(commits[best], currentParent, gitdir);
    if (packBuffer.length < MIN_SIZE_THRESHOLD && best + 1 < commits.length) {
      const nextBestIndex = best + 1;
      const nextEndOid = commits[nextBestIndex];
      try {
        // Try to include the next commit to avoid small pack files
        packBuffer = await gitCreatePackForRange(nextEndOid, currentParent, gitdir);
        best = nextBestIndex;
      } catch {}
    }

    const packfilePath = await savePackFile(tempPackDir, packBuffer);
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

/**
 * Creates a series of pack files, chunking commits from parentOid to newOid
 * based on a maximum size limit.
 * @param branchRef The branch reference.
 * @param newOid The latest commit OID.
 * @param parentOid The old common ancestor OID (exclusive, can be null).
 * @param gitdir Path to the .git directory.
 * @param maxSizeBytes Maximum size allowed per pack file.
 * @returns Promise<PackCreationResult> Pack file chunk info and temporary directory.
 */
export async function createCommitBoundaryPacks(
    branchRef: string,
    newOid: string,
    parentOid: string | null,
    gitdir: string,
    maxSizeBytes: number = MAX_PACK_SIZE_DEFAULT
): Promise<PackCreationResult> {
  const tempPackDir = path.join(os.tmpdir(), `git-adaptive-${uuidv4().substring(0, 8)}`);
  await fs.mkdir(tempPackDir, { recursive: true });

  try {
    let validParent = parentOid;
    // 1. Validate parentOid
    if (parentOid && !(await gitParentExistsOnBranch(parentOid, branchRef, gitdir))) {
      log(`[warn] parentOid ${parentOid} not an ancestor of ${branchRef}, ignoring.`);
      validParent = null;
    }

    // 2. Get the list of commits
    const commits = await gitGetAllCommits(newOid, validParent, gitdir);
    if (!commits.length) return { chunks: [], tempDir: tempPackDir };

    // 3. Complex path: Binary search chunking
    return await binarySearchPackCreation(commits, validParent, maxSizeBytes, tempPackDir, gitdir);

  } catch (err) {
    await fs.rm(tempPackDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`create packfile failed: ${(err as Error).message}`);
  }
}
