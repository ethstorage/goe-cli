import { spawn } from 'node:child_process';
function spawnWithOutput(command, args, options, input) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, options);
        const chunks = [];
        if (!child.stdout)
            return reject(new Error(`stdout not piped for ${command}`));
        child.stdout.on('data', (chunk) => chunks.push(chunk));
        child.on('error', reject);
        child.on('close', (code, signal) => {
            if (code === 0)
                resolve(Buffer.concat(chunks));
            else
                reject(new Error(`Command "${command} ${args.join(' ')}" exited ${code ?? signal}`));
        });
        if (child.stdin)
            child.stdin.end(input);
    });
}
function spawnNoOutput(command, args, options = {}, input) {
    const adjusted = {
        ...options,
        stdio: options.stdio ?? ['pipe', 'ignore', 'inherit'],
    };
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, adjusted);
        child.on('error', reject);
        child.on('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`Command "${command} ${args.join(' ')}" exited ${code ?? signal}`)));
        if (child.stdin)
            child.stdin.end(input);
    });
}
async function runCmdCapture(args) {
    const buf = await spawnWithOutput(args[0], args.slice(1), { stdio: ['ignore', 'pipe', 'inherit'] });
    return buf.toString('utf8');
}
// --- Git Tool Functions ---
export async function createPackFileBuffer(newOid, parentOid) {
    const revs = parentOid ? `${newOid}\n^${parentOid}\n` : `${newOid}\n`;
    return spawnWithOutput('git', ['pack-objects', '--stdout', '--revs', '--thin', '--delta-base-offset'], { stdio: ['pipe', 'pipe', 'inherit'] }, Buffer.from(revs, 'utf8'));
}
export async function runGitIndexPackFromBuf(buf, gitDir) {
    return spawnNoOutput('git', ['index-pack', '--stdin', '--fix-thin', '--keep', '-v'], { cwd: gitDir, stdio: ['pipe', 'ignore', 'inherit'] }, buf);
}
export async function getLocalCommitOids(refName) {
    try {
        await spawnNoOutput('git', ['show-ref', '--quiet', '--verify', refName]);
    }
    catch {
        return new Set();
    }
    try {
        const output = await runCmdCapture(['git', 'rev-list', refName]);
        return new Set(output.trim().split('\n').filter(Boolean));
    }
    catch (err) {
        console.error(`Warning: 'git rev-list ${refName}' failed: ${err}`);
        return new Set();
    }
}
export async function getOidFromRef(refName) {
    const args = ["git", "rev-parse", refName];
    const output = await runCmdCapture(args);
    return output.trim();
}
