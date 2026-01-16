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
const CLONE_DIR = path.join(TEMP_DIR, 'clone');

const PRIVATE_KEY = process.env.GOE_TEST_PK;
const PASSWORD = process.env.GOE_TEST_PASSWORD;

if (!PRIVATE_KEY || !PASSWORD) {
	console.error('Please set GOE_TEST_PK and GOE_TEST_PASSWORD in .env');
	process.exit(1);
}


/* -------- exec: capture stdout -------- */
export const testCommandExec = (command) => {
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
};

/* -------- spawn: realtime -------- */
export const testCommandSpawn = (command, args, options = {}) => {
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
};


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
async function gitFlow(repoAddress) {
	const repoPath = path.join(TEMP_DIR, 'repo');
	fs.mkdirSync(repoPath, { recursive: true });
	process.chdir(repoPath);

	await testCommandSpawn('git', ['init']);
	await testCommandSpawn('git', [
		'remote',
		'add',
		'origin',
		`goe://${repoAddress}:${CHAIN_ID}`
	]);
	await testCommandSpawn('git', ['checkout', '-b', 'main']);

	fs.writeFileSync('README.md', '# GoE E2E\n');
	await testCommandSpawn('git', ['add', '.']);
	await testCommandSpawn('git', ['commit', '-m', 'init']);
	await testCommandSpawn('git', ['push', 'origin', 'main']);

	await testCommandSpawn('git', ['checkout', '-b', 'feature']);
	fs.writeFileSync('feature.txt', 'feature\n');
	await testCommandSpawn('git', ['add', '.']);
	await testCommandSpawn('git', ['commit', '-m', 'feature']);
	await testCommandSpawn('git', ['push', 'origin', 'feature']);

	fs.writeFileSync('feature.txt', 'force\n');
	await testCommandSpawn('git', ['add', '.']);
	await testCommandSpawn('git', ['commit', '-m', `force-update`]);
	await testCommandSpawn('git', ['push', '--force', 'origin', 'feature']);

	await testCommandSpawn('git', ['push', 'origin', '--delete', 'feature']);
}

async function gitCloneVerify(repoAddress) {
	process.chdir(TEMP_DIR);

	await testCommandSpawn('git', [
		'clone',
		`goe://${repoAddress}:${CHAIN_ID}`,
		CLONE_DIR
	]);

	const readme = fs.readFileSync(
			path.join(CLONE_DIR, 'README.md'),
			'utf8'
	);
	if (!readme.includes('GoE E2E')) {
		throw new Error('Clone verification failed');
	}

	process.chdir(CLONE_DIR);
	const branches = await testCommandExec('git branch -r');
	if (branches.includes('feature')) {
		throw new Error('Deleted branch still exists');
	}
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
	try {
		await gitFlow(address);
		await gitCloneVerify(address);
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
