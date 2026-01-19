// test/goeE2ETest.mjs
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { exec, spawn } from 'child_process';
import { fileURLToPath } from 'url';

const DIST_CLI = path.resolve('./dist/cli/index.js');
const CHAIN_ID = 11155111;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../test');
const TEMP_DIR = path.join(PROJECT_ROOT, '/.tmp');

const PRIVATE_KEY = process.env.GOE_TEST_PK;
const PASSWORD = process.env.GOE_TEST_PASSWORD;

if (!PRIVATE_KEY || !PASSWORD) {
	console.error('Please set GOE_TEST_PK and GOE_TEST_PASSWORD in .env');
	process.exit(1);
}


/* -------- exec: capture stdout -------- */
function testCommandExec(command) {
	console.log(`\n[exec] ${command}`);
	return new Promise((resolve, reject) => {
		exec(command, (error, stdout, stderr) => {
			if (error) {
				console.error(error.message);
				return reject(error);
			}
			if (stderr) {
				console.error(stderr.trim());
			}
			if (stdout) {
				console.log(stdout.trim());
			}
			resolve(stdout || '');
		});
	});
}

/* -------- spawn: realtime -------- */
function testCommandSpawn(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		console.log(`\n[spawn] ${command} ${args.join(' ')}`);

		const p = spawn(command, args, {
			stdio: 'inherit',
			shell: true,
			...options
		});

		p.on('close', (code) => {
			if (code !== 0) {
				return reject(new Error(`Process exited with code ${code}`));
			}
			resolve(true);
		});
	});
}

/* ---------------- utils ---------------- */

const randomRepoName = () =>
		`goe-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const stripAnsi = (s) =>
		s.replace(/\x1B\[[0-9;]*m/g, '');


/* ------------------- Wallet ------------------- */
async function checkWalletExists() {
	const out = await testCommandExec(`node ${DIST_CLI} wallet list`);
	if (out.includes('No wallets found')) {
		throw new Error('No wallet exists. Create and fund one first.');
	}
}

async function unlockWallet() {
	console.log('Unlocking wallet using GOE_TEST_PASSWORD...');
	await testCommandSpawn(
			'node',
			[DIST_CLI, 'wallet', 'unlock'],
			{
				env: {
					...process.env,
					GOE_TEST_MODE: '1',
					GOE_TEST_PASSWORD: PASSWORD
				}
			}
	);
}

const lockWallet = () =>
		testCommandExec(
				`node ${DIST_CLI} wallet lock`
		);

/* ------------------- Repo ------------------- */
async function createRepo() {
	const name = randomRepoName();
	const out = await testCommandExec(
			`node ${DIST_CLI} repo create ${name} --chain-id ${CHAIN_ID}`
	);
	const match = stripAnsi(out).match(/0x[a-fA-F0-9]{40}/);
	if (!match) {
		throw new Error('Repo address not found');
	}

	return { name, address: match[0] };
}

const listRepos = () =>
		testCommandExec(`node ${DIST_CLI} repo list --chain-id ${CHAIN_ID}`);

const listBranches = (addr) =>
		testCommandExec(
				`node ${DIST_CLI} repo branches ${addr} --chain-id ${CHAIN_ID}`
		);

const setDefaultBranch = (addr) =>
		testCommandSpawn(
				'node',
				[DIST_CLI, 'repo', 'default-branch', addr, 'main', '--chain-id', CHAIN_ID]
		);

/* ------------------- Git flow ------------------- */
async function gitFlow(goe) {
	const repoPath = path.join(TEMP_DIR, 'flow');
	fs.mkdirSync(repoPath, { recursive: true });
	process.chdir(repoPath);

	// init + remote
	await testCommandSpawn('git', ['init']);
	await testCommandSpawn('git', ['remote', 'add', 'origin', goe]);
	await testCommandSpawn('git', ['checkout', '-b', 'main']);

	// init commit
	fs.writeFileSync('README.md', '# GoE E2E\n');
	await testCommandSpawn('git', ['add', '.']);
	await testCommandSpawn('git', ['commit', '-m', 'init']);
	await testCommandSpawn('git', ['push', 'origin', 'main']);

	// feature branch
	await testCommandSpawn('git', ['checkout', '-b', 'feature']);
	fs.writeFileSync('feature.txt', 'feature\n');
	await testCommandSpawn('git', ['add', '.']);
	await testCommandSpawn('git', ['commit', '-m', 'feature']);
	await testCommandSpawn('git', ['push', 'origin', 'feature']);

	// force push
	fs.writeFileSync('feature.txt', 'force\n');
	await testCommandSpawn('git', ['add', '.']);
	await testCommandSpawn('git', ['commit', '-m', 'force-update']);
	await testCommandSpawn('git', ['push', '--force', 'origin', 'feature']);

	// delete branch
	await testCommandSpawn('git', ['push', 'origin', '--delete', 'feature']);
}

async function gitCloneVerify(goe) {
	const clonePath = path.join(TEMP_DIR, 'clone');
	fs.mkdirSync(clonePath, { recursive: true });
	process.chdir(TEMP_DIR);

	await testCommandSpawn('git', ['clone', goe, clonePath]);
	process.chdir(clonePath);

	const readme = fs.readFileSync(path.join(clonePath, 'README.md'), 'utf8');
	if (!readme.includes('GoE E2E')) throw new Error('Clone verification failed');

	const head = await testCommandExec('git symbolic-ref HEAD');
	if (!head.includes('refs/heads/main')) throw new Error('HEAD is not refs/heads/main');

	const branches = await testCommandExec('git branch -r');
	if (branches.includes('feature')) throw new Error('Deleted branch still exists');
}

async function gitRejectNonFastForward(goe) {
	const repoPath = path.join(TEMP_DIR, 'nff');
	fs.mkdirSync(repoPath, { recursive: true });
	process.chdir(repoPath);

	await testCommandSpawn('git', ['clone', goe, '.']);

	// push new file
	fs.writeFileSync('nff.txt', '1');
	await testCommandSpawn('git', ['add', '.']);
	await testCommandSpawn('git', ['commit', '-m', 'nff-1']);
	await testCommandSpawn('git', ['push', 'origin', 'main']);

	// reset head
	await testCommandSpawn('git', ['reset', '--hard', 'HEAD~1']);

	// non-fast-forward push should fail
	try {
		await testCommandSpawn('git', ['push', 'origin', 'main']);
		throw new Error('Expected non-fast-forward push to fail');
	} catch {
		console.log('[expected] non-fast-forward rejected');
	}
}

async function gitMergePush(goe) {
	const repoPath = path.join(TEMP_DIR, 'merge');
	fs.mkdirSync(repoPath, { recursive: true });
	process.chdir(repoPath);

	await testCommandSpawn('git', ['clone', goe, '.']);

	// create a branch and commit
	await testCommandSpawn('git', ['checkout', '-b', 'merge-a']);
	fs.writeFileSync('a.txt', 'a');
	await testCommandSpawn('git', ['add', 'a.txt']);
	await testCommandSpawn('git', ['commit', '-m', 'a']);

	// merge back to main
	await testCommandSpawn('git', ['checkout', 'main']);
	await testCommandSpawn('git', ['merge', 'merge-a']);

	await testCommandSpawn('git', ['push', 'origin', 'main']);
}

async function gitFetchUpdate(goe) {
	const repoPath = path.join(TEMP_DIR, 'fetch');
	fs.mkdirSync(repoPath, { recursive: true });
	process.chdir(repoPath);

	await testCommandSpawn('git', ['clone', goe, '.']);

	fs.writeFileSync('fetch.txt', 'x');
	await testCommandSpawn('git', ['add', 'fetch.txt']);
	await testCommandSpawn('git', ['commit', '-m', 'fetch-update']);
	await testCommandSpawn('git', ['push', 'origin', 'main']);

	// simulate fetch from another clone
	const clonePath = path.join(TEMP_DIR, 'fetch-clone');
	fs.mkdirSync(clonePath, { recursive: true });
	await testCommandSpawn('git', ['clone', goe, clonePath]);
	process.chdir(clonePath);

	await testCommandSpawn('git', ['fetch', 'origin']);
	const success = await testCommandSpawn('git', ['log', 'origin/main', '--oneline', '-1'], { capture: true });
	if (!success) throw new Error('Fetch did not update origin/main');
}


function cleanup() {
	process.chdir(PROJECT_ROOT);
	fs.rmSync(TEMP_DIR, { recursive: true, force: true });
	console.log('Local test data cleaned');
}

/* ------------------- main ------------------- */
async function npmLink() {
	console.log('\nLinking local goe-cli...');
	await testCommandSpawn('npm', ['link']);
}

(async () => {
	fs.mkdirSync(TEMP_DIR, { recursive: true });

	// goe
	await npmLink();
	await checkWalletExists();
	await unlockWallet();
	const {name, address} = await createRepo();
	await listRepos();

	// git helper
	const goe = `goe://${name}:${CHAIN_ID}`
	try {
		await gitFlow(goe);
		await gitCloneVerify(goe);
		await gitRejectNonFastForward(goe);
		await gitMergePush(goe);
		await gitFetchUpdate(goe);
	} finally {
		cleanup();
	}

	await listBranches(address);
	await setDefaultBranch(address);
	await lockWallet();
	console.log('\n=== GoE E2E test finished successfully ===');
})().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
