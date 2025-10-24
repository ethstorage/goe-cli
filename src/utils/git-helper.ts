import { spawn, SpawnOptions } from 'node:child_process';

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
export async function createPackFileBuffer(newOid: string, parentOid?: string): Promise<Buffer> {
  const revs = parentOid ? `${newOid}\n^${parentOid}\n` : `${newOid}\n`;
  return spawnWithOutput(
      'git',
      ['pack-objects', '--stdout', '--revs', '--thin', '--delta-base-offset'],
      { stdio: ['pipe', 'pipe', 'inherit'] },
      Buffer.from(revs, 'utf8')
  );
}

export async function runGitIndexPackFromFile(packFilePath: string, gitDir: string): Promise<void> {
  return spawnNoOutput(
      'git',
      ['index-pack', '--keep', '-v', packFilePath],
      { cwd: gitDir, stdio: ['ignore', 'ignore', 'inherit'] }
  );
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
