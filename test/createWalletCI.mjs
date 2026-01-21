import path from 'path';
import { runCommand } from "./runCommand.mjs";

const DIST_CLI = path.resolve('./dist/cli/index.js');
const PASSWORD  = '12345678';

(async () => {
	try {
		const output = await runCommand(
				'node',
				[DIST_CLI, 'wallet', 'create'],
				{
					env: {
						GOE_TEST_MODE: '1',
						GOE_TEST_PASSWORD: PASSWORD,
					},
					capture: true
				}
		);
		if (!output.includes('Wallet Address:')) {
			throw new Error('Wallet creation failed: no address found');
		}

		console.log('Unlocking wallet using GOE_TEST_PASSWORD...');
		await runCommand(
				'node',
				[DIST_CLI, 'wallet', 'unlock'],
				{
					env: {
						GOE_TEST_MODE: '1',
						GOE_TEST_PASSWORD: PASSWORD,
					},
				}
		);

		await runCommand('node', [DIST_CLI, 'wallet', 'lock']);

		console.log('✅ Wallet create + unlock/lock test passed!');
	} catch (e) {
		console.error('❌ Wallet create test failed:', e.message);
		process.exit(1);
	}
})();
