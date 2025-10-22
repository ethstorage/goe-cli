import { spawn } from 'node:child_process';
export function runCmdCapture(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(args[0], args.slice(1), { stdio: ['ignore', 'pipe', 'inherit'] });
        let buf = '';
        child.stdout.on('data', d => buf += d.toString());
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve(buf) : reject(new Error('cmd exit ' + code)));
    });
}
export async function createPackFileBuffer(newOid, parentOid) {
    const revs = parentOid ? `${newOid}\n^${parentOid}\n` : `${newOid}\n`;
    return new Promise((resolve, reject) => {
        const chunks = [];
        const child = spawn("git", ["pack-objects", "--stdout", "--revs", "--thin", "--delta-base-offset"], { stdio: ["pipe", "pipe", "inherit"] });
        child.stdout.on("data", (d) => chunks.push(d));
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) {
                resolve(Buffer.concat(chunks));
            }
            else {
                reject(new Error(`git pack-objects exited with code ${code}`));
            }
        });
        child.stdin.end(Buffer.from(revs, "utf8"));
    });
}
export async function runGitIndexPackFromBuf(buf, gitDir) {
    return new Promise((resolve, reject) => {
        const child = spawn("git", ["index-pack", "--stdin", "--fix-thin", "--keep", "-v"], { cwd: gitDir, stdio: ["pipe", "ignore", "inherit"] });
        child.on("error", reject);
        child.on("close", code => (code === 0 ? resolve() : reject(new Error(`git index-pack exited ${code}`))));
        child.stdin.end(buf);
    });
}
export async function getLocalCommitOids(refName) {
    try {
        await runCmdCapture([
            "git", "show-ref", "--quiet", "--verify", refName
        ]);
    }
    catch (error) {
        return new Set();
    }
    const cmd = ["git", "rev-list", refName];
    try {
        const output = await runCmdCapture(cmd);
        const lines = output.trim().split('\n').filter(line => line.trim() !== '');
        return new Set(lines.map(line => line.split(/\s+/)[0]));
    }
    catch (error) {
        console.error(`Warning: 'git rev-list --objects ${refName}' failed. Assuming no local objects: ${error}`);
        return new Set();
    }
}
