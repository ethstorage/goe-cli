import { program, Option } from "commander";
import {Factory, Repo, RepoInfo} from "./contract.js";
import { logInfo, logSuccess, logError } from "../utils/log.js";


// 🌐 Common chainId option
const chainIdOption = new Option(
    "-c, --chain-id <number>",
    "Specify the chain ID (e.g., 1=Mainnet, 5=Goerli, 11155111=Sepolia)"
).argParser((val) => parseInt(val, 10));

const repoCmd = program
    .command("repo")
    .description("Manage decentralized repositories")
    .addOption(chainIdOption);

// =============== 🧱 Factory Commands =================

// Create repository
repoCmd
    .command("create <name>")
    .description("Create a new repository (requires --chain-id)")
    .action(async (name, cmd) => {
        const opts = cmd.parent?.opts?.() ?? {};
        if (!opts.chainId) return logError("You must specify --chain-id.");

        try {
            logInfo(`Creating repository "${name}" on chain ${opts.chainId}...`);
            const repoAddress = await Factory.createRepo(name, opts.chainId);
            logSuccess(`Repository created successfully: ${repoAddress}`);
            console.log(`🔗 Access via: eths://${repoAddress}:${opts.chainId}`);
        } catch (e: any) {
            logError(`Failed to create repository: ${e.message}`);
        }
    });

// List repositories
repoCmd
    .command("list")
    .description("List repositories owned by the current wallet on the specified chain")
    .option("-s, --start <number>", "Start index", (val) => parseInt(val, 10), 0)
    .option("-l, --limit <number>", "Items per page", (val) => parseInt(val, 10), 20)
    .action(async (cmd) => {
        const opts = cmd.parent?.opts?.() ?? {};
        if (!opts.chainId) return logError("You must specify --chain-id.");

        try {
            const repos = await Factory.getUserReposPaginated(opts.chainId, cmd.start, cmd.limit);
            if (repos.length === 0) return logInfo(`No repositories found on chain ${opts.chainId}.`);

            logSuccess(`Found ${repos.length} repositories:`);
            repos.forEach((repo: RepoInfo, idx: number) => {
                console.log(`${idx + 1}. ${repo.name} (${repo.address})  Created: ${repo.creationTime.toLocaleString()}`);
            });
        } catch (e: any) {
            logError(`Failed to fetch repositories: ${e.message}`);
        }
    });


// =============== 🧱 Repo Commands =================
// Set default branch
repoCmd
    .command("default-branch <repo-address|ENS> <branch>")
    .description("Set the default branch of a repository (requires --chain-id)")
    .action(async (repo, branch, cmd) => {
        const opts = cmd.parent?.opts?.() ?? {};
        if (!opts.chainId) return logError("You must specify --chain-id.");

        try {
            logInfo(`Setting default branch for ${repo} to "${branch}"...`);
            await Repo.setDefaultBranch(repo, opts.chainId, branch);
            logSuccess(`Default branch updated to "${branch}".`);
        } catch (e: any) {
            logError(`Failed to set default branch: ${e.message}`);
        }
    });

// Grant push permission
repoCmd
    .command("grant-push <repo-address|ENS> <address>")
    .description("Grant push permission to an address (requires --chain-id)")
    .action(async (repo, address, cmd) => {
        const opts = cmd.parent?.opts?.() ?? {};
        if (!opts.chainId) return logError("You must specify --chain-id.");

        try {
            logInfo(`Granting push permission to ${address} on ${repo}...`);
            await Repo.addPusher(repo, opts.chainId, address);
            logSuccess(`Push permission granted to ${address}.`);
        } catch (e: any) {
            logError(`Failed to grant push permission: ${e.message}`);
        }
    });

// Revoke push permission
repoCmd
    .command("revoke-push <repo-address|ENS> <address>")
    .description("Revoke push permission from an address (requires --chain-id)")
    .action(async (repo, address, cmd) => {
        const opts = cmd.parent?.opts?.() ?? {};
        if (!opts.chainId) return logError("You must specify --chain-id.");

        try {
            logInfo(`Revoking push permission from ${address}...`);
            await Repo.removePusher(repo, opts.chainId, address);
            logSuccess(`Push permission revoked from ${address}.`);
        } catch (e: any) {
            logError(`Failed to revoke push permission: ${e.message}`);
        }
    });

// Grant maintainer permission
repoCmd
    .command("grant-maintainer <repo-address|ENS> <address>")
    .description("Grant maintainer permission to an address (requires --chain-id)")
    .action(async (repo, address, cmd) => {
        const opts = cmd.parent?.opts?.() ?? {};
        if (!opts.chainId) return logError("You must specify --chain-id.");

        try {
            logInfo(`Granting maintainer role to ${address} on ${repo}...`);
            await Repo.addMaintainer(repo, opts.chainId, address);
            logSuccess(`Maintainer role granted to ${address}.`);
        } catch (e: any) {
            logError(`Failed to grant maintainer role: ${e.message}`);
        }
    });

export default repoCmd;
