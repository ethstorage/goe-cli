import {spawn} from 'child_process';
import {join} from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import {v4 as uuidv4} from 'uuid';
import pLimit from 'p-limit';

export interface PackFileChunk {
    path: string;
    size: number;
    startOid: string; // parent OID used as base for this pack
    endOid: string;   // last commit included in this pack
}


// Helper: run git and collect stdout
async function execGit(args: string[], gitdir: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const child = spawn('git', args, { cwd: gitdir, stdio: ['pipe', 'pipe', 'inherit'] });
        const bufs: Buffer[] = [];
        if (!child.stdout) return reject(new Error('git stdout missing'));

        child.stdout.on('data', (b) => bufs.push(Buffer.from(b)));
        child.on('error', reject);
        child.on('close', (code, signal) => {
            if (code === 0) resolve(Buffer.concat(bufs).toString('utf8'));
            else reject(new Error(`git ${args.join(' ')} exited ${code ?? signal}`));
        });
        child.stdin.end();
    });
}

// Create a pack file for a commit range
async function createPackForRange(
    endOid: string,
    parentOid: string | null,
    packDir: string,
    gitdir: string
): Promise<{ path: string; size: number; idxPath: string }> {
    const prefix = `pack_${uuidv4().replace(/-/g, '')}`;
    const outputBase = join(packDir, prefix);

    const revs = parentOid ? `${endOid}\n^${parentOid}\n` : `${endOid}\n`;
    const args = ['pack-objects', '--revs', '--thin', '--delta-base-offset', outputBase];

    await new Promise<void>((resolve, reject) => {
        const child = spawn('git', args, {
            cwd: gitdir,
            stdio: ['pipe', 'ignore', 'inherit'],
        });
        child.stdin.write(Buffer.from(revs, 'utf8'));
        child.stdin.end();
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`pack-objects failed ${code}`));
        });
    });

    const packPath = `${outputBase}.pack`;
    const idxPath = `${outputBase}.idx`;
    await fs.access(packPath);
    const stat = await fs.stat(packPath);
    return { path: packPath, size: stat.size, idxPath };
}


// Parse commit list (oldest -> newest)
async function getAllCommits(newOid: string, parentOid: string | null, gitdir: string): Promise<string[]> {
    const args = ['rev-list', '--topo-order', '--reverse', newOid];
    if (parentOid) args.push(`^${parentOid}`);
    const out = await execGit(args, gitdir);
    return out.trim().split(/\s+/).filter(Boolean);
}

// Estimate per-commit delta size using git log --numstat
async function estimateCommitSizesByNumstat(commits: string[], gitdir: string, defaultBytesPerLine = 50): Promise<number[]> {
    if (commits.length === 0) return [];
    const first = commits[0];
    const last = commits[commits.length - 1];
    const range = first === last ? `${first}` : `${first}^..${last}`;

    const args = ['log', '--format=%H', '--no-renames', '--numstat', range];
    let out: string;
    try {
        out = await execGit(args, gitdir);
    } catch (e) {
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
                map.set(currentHash, prev + linesChanged * defaultBytesPerLine);
            }
        }
    }

    return commits.map(c => map.get(c) ?? Math.max(1024, defaultBytesPerLine * 2));
}


export async function createCommitBoundaryPacksOptimized(
    newOid: string,
    parentOid: string | null,
    gitdir: string,
    maxSizeBytes: number = 100 * 1024 * 1024
): Promise<PackFileChunk[]> {
    const chunks: PackFileChunk[] = [];
    const tempPackDir = join(os.tmpdir(), `eths-packs-${uuidv4().substring(0, 8)}`);
    await fs.mkdir(tempPackDir, { recursive: true });

    const concurrency = Math.min(os.cpus().length, 4);
    const limit = pLimit(concurrency);

    try {
        const commits = await getAllCommits(newOid, parentOid, gitdir);
        if (commits.length === 0) return [];

        const bytesPerLineDefault = 50;
        let estimates = await estimateCommitSizesByNumstat(commits, gitdir, bytesPerLineDefault);

        let correctionFactor = 0.2;
        const emaAlpha = 0.25;

        const prefixSum: number[] = new Array(estimates.length + 1);
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
            let lastPackResult: { path: string; size: number; idxPath: string } | null = null;
            const tempPacksToClean: Array<{ pack: string; idx: string }> = [];

            while (left <= right) {
                const mid = Math.floor((left + right) / 2);
                const trialOid = commits[mid];

                const trialPackPromise = limit(() =>
                    createPackForRange(trialOid, currentParent, tempPackDir, gitdir)
                );

                try {
                    const trialPack = await trialPackPromise;
                    tempPacksToClean.push({ pack: trialPack.path, idx: trialPack.idxPath });

                    if (trialPack.size <= maxSizeBytes) {
                        best = mid;
                        lastPackResult = trialPack;
                        left = mid + 1;
                    } else {
                        right = mid - 1;
                    }
                } catch (e) {
                    right = mid - 1;
                }
            }

            if (!lastPackResult || best < idx) {
                await Promise.all(tempPacksToClean.map(p =>
                    Promise.all([fs.rm(p.pack, { force: true }), fs.rm(p.idx, { force: true })])
                ));
                lastPackResult = await createPackForRange(commits[idx], currentParent, tempPackDir, gitdir);
                best = idx;
            }

            if (lastPackResult && lastPackResult.size > maxSizeBytes) {
                await Promise.all(tempPacksToClean.map(p =>
                    Promise.all([fs.rm(p.pack, { force: true }), fs.rm(p.idx, { force: true })])
                ));
                await fs.rm(lastPackResult.path, { force: true });
                await fs.rm(lastPackResult.idxPath, { force: true });
                lastPackResult = await createPackForRange(commits[best], currentParent, tempPackDir, gitdir);
            } else if (lastPackResult) {
                await Promise.all(tempPacksToClean.map(p =>
                    Promise.all([fs.rm(p.pack, { force: true }), fs.rm(p.idx, { force: true })])
                ));
                const recreatedPack = await createPackForRange(commits[best], currentParent, tempPackDir, gitdir);
                await fs.rm(lastPackResult.path, { force: true });
                await fs.rm(lastPackResult.idxPath, { force: true });
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

        return chunks;
    } catch (err) {
        await fs.rm(tempPackDir, { recursive: true, force: true });
        throw err;
    }
}
