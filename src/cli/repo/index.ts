import { Command, Option } from "commander";
import { Factory, Repo, RepoInfo } from "./contract.js";
import { logger } from "../utils/log.js";


// 🌐 Common chainId option
const chainIdOption = new Option(
    "-c, --chain-id <number>",
    "Specify the chain ID (e.g., 1=Mainnet, 11155111=Sepolia)"
).argParser((val) => parseInt(val, 10));

const repoCmd = new Command('repo')
    .description('Manage decentralized repositories');


function resolveChainId(cmd: any): number | null {
    const chainId = cmd.chainId ?? (process.env.GOE_CHAIN_ID ? parseInt(process.env.GOE_CHAIN_ID, 10) : undefined);
    if (!Number.isInteger(chainId)) return null;
    return chainId;
}

// =============== 🧱 Factory Commands =================

// Create repository
repoCmd
    .command("create <name>")
    .addOption(chainIdOption)
    .description("Create a new repository (requires --chain-id)")
    .action(async (name, cmd) => {
        const chainId = resolveChainId(cmd);
        if (chainId === null) return logger.error("Chain ID not specified. Use --chain-id or set GOE_CHAIN_ID environment variable.");

        try {
            logger.info(`Creating repository "${name}" on chain ${chainId}...`);
            const repoAddress = await Factory.createRepo(name, chainId);
            logger.success(`Repository created successfully: ${repoAddress}`);
            logger.normal(`🔗 Access via:`);
            logger.normal(`    goe://${repoAddress}:${chainId}     (recommended)`);
            logger.normal(`    goe://${name}:${chainId}            (local alias, current wallet only)`);
        } catch (e: any) {
            logger.error(`Failed to create repository: ${e.message}`);
        }
    });

// List repositories
repoCmd
    .command("list")
    .description("List repositories owned by the current wallet on the specified chain")
    .addOption(chainIdOption)
    .option("-s, --start <number>", "Start index", (val) => parseInt(val, 10), 0)
    .option("-l, --limit <number>", "Items per page", (val) => parseInt(val, 10), 20)
    .action(async (cmd) => {
        const chainId = resolveChainId(cmd);
        if (chainId === null) return logger.error("Chain ID not specified. Use --chain-id or set GOE_CHAIN_ID environment variable.");

        try {
            const repos = await Factory.getReposPaginated(chainId, cmd.start, cmd.limit);
            if (repos.length === 0) return logger.info(`No repositories found on chain ${chainId}.`);

            logger.success(`Found ${repos.length} repositories:`);
            repos.forEach((repo: RepoInfo, idx: number) => {
                logger.normal(`${idx + 1}. ${repo.address} (${repo.name})  Created: ${repo.creationTime.toLocaleString()}`);
            });
        } catch (e: any) {
            logger.error(`Failed to fetch repositories: ${e.message}`);
        }
    });


// =============== 🧱 Repo Commands =================
// Set default branch
repoCmd
    .command("default-branch <repo-address|ENS> <branch>")
    .addOption(chainIdOption)
    .description("Set the default branch of a repository (requires --chain-id)")
    .action(async (repo, branch, cmd) => {
        const chainId = resolveChainId(cmd);
        if (chainId === null) return logger.error("Chain ID not specified. Use --chain-id or set GOE_CHAIN_ID environment variable.");

        try {
            logger.info(`Setting default branch for ${repo} to "${branch}"...`);
            await Repo.setDefaultBranch(repo, chainId, branch);
            logger.success(`Default branch updated to "${branch}".`);
        } catch (e: any) {
            logger.error(`Failed to set default branch: ${e.message}`);
        }
    });

// Grant push permission
repoCmd
    .command("grant-push <repo-address|ENS> <address>")
    .addOption(chainIdOption)
    .description("Grant push permission to an address (requires --chain-id)")
    .action(async (repo, address, cmd) => {
        const chainId = resolveChainId(cmd);
        if (chainId === null) return logger.error("Chain ID not specified. Use --chain-id or set GOE_CHAIN_ID environment variable.");

        try {
            logger.info(`Granting push permission to ${address} on ${repo}...`);
            await Repo.addPusher(repo, chainId, address);
            logger.success(`Push permission granted to ${address}.`);
        } catch (e: any) {
            logger.error(`Failed to grant push permission: ${e.message}`);
        }
    });

// Revoke push permission
repoCmd
    .command("revoke-push <repo-address|ENS> <address>")
    .addOption(chainIdOption)
    .description("Revoke push permission from an address (requires --chain-id)")
    .action(async (repo, address, cmd) => {
        const chainId = resolveChainId(cmd);
        if (chainId === null) return logger.error("Chain ID not specified. Use --chain-id or set GOE_CHAIN_ID environment variable.");

        try {
            logger.info(`Revoking push permission from ${address}...`);
            await Repo.removePusher(repo, chainId, address);
            logger.success(`Push permission revoked from ${address}.`);
        } catch (e: any) {
            logger.error(`Failed to revoke push permission: ${e.message}`);
        }
    });

// Grant maintainer permission
repoCmd
    .command("grant-maintainer <repo-address|ENS> <address>")
    .addOption(chainIdOption)
    .description("Grant maintainer permission to an address (requires --chain-id)")
    .action(async (repo, address, cmd) => {
        const chainId = resolveChainId(cmd);
        if (chainId === null) return logger.error("Chain ID not specified. Use --chain-id or set GOE_CHAIN_ID environment variable.");

        try {
            logger.info(`Granting maintainer role to ${address} on ${repo}...`);
            await Repo.addMaintainer(repo, chainId, address);
            logger.success(`Maintainer role granted to ${address}.`);
        } catch (e: any) {
            logger.error(`Failed to grant maintainer role: ${e.message}`);
        }
    });

repoCmd
    .command("branches <repo-address|ENS>")
    .addOption(chainIdOption)
    .description("List all branches in a repository")
    .action(async (repo, cmd) => {
        const chainId = resolveChainId(cmd);
        if (chainId === null) return logger.error("Chain ID not specified. Use --chain-id or set GOE_CHAIN_ID environment variable.");

        try {
            logger.info(`Fetching branches for ${repo}...`);
            const list = await Repo.listBranches(repo, chainId);
            if (list.length === 0) {
                logger.info("No branches found.");
                return;
            }

            let defaultBranch: string | null = null;
            try {
                defaultBranch = await Repo.getDefaultBranch(repo, chainId);
            } catch {}

            logger.success(`Found ${list.length} branches:`);
            list.forEach((b, idx) => {
                const marker = b.name === defaultBranch ? " (default)" : "";
                logger.normal(`${idx + 1}. ${b.name}${marker}   (head: ${b.hash})`);
            });
        } catch (e: any) {
            logger.error(`Failed to fetch branches: ${e.message}`);
        }
    });

export default repoCmd;
