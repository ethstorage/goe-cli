/* -------- exec: capture stdout -------- */
import {spawn} from "child_process";

export function runCommand(cmd, args = [], options = {}) {
	const {
		capture = false,
		env = {},
		cwd,
	} = options;

	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, {
			shell: false,                // ⭐
			stdio: capture ? 'pipe' : 'inherit',
			env: { ...process.env, ...env },
			cwd,
		});

		let stdout = '';
		let stderr = '';

		if (capture) {
			child.stdout.on('data', d => (stdout += d));
			child.stderr.on('data', d => (stderr += d));
		}

		child.on('error', reject);

		child.on('close', (code) => {
			if (code !== 0) {
				return reject(
						new Error(
								stderr.trim() || `Command failed: ${cmd} ${args.join(' ')}`
						)
				);
			}
			resolve(capture ? stdout : true);
		});
	});
}
