// manager repo
import {program} from "commander";
import {
    createRepo,
    getUserReposPaginated,
    setDefaultBranch,
    addPusher,
    removePusher,
    addMaintainer,
} from "./contract.js";

const repoCmd = program.command('repo').description('Manage repositories');

repoCmd
    .command('create <name>')
    .description('Create a new repository')
    .action(async (name) => {
        try {
            const address = await createRepo(name);
            console.log(`✅ Repository "${name}" created at ${address}`);
        } catch (e) {
            console.error(`❌ Error: ${e.message}`);
        }
    });

repoCmd
    .command('list')
    .description('List all your repositories')
    .action(async () => {
        try {
            const repos = await getUserReposPaginated();
            if (repos.length === 0) {
                console.log('No repositories found.');
                return;
            }
            repos.forEach(r => {
                console.log(`- ${r.name} (${r.address}) - created at ${r.creationTime}`);
            });
        } catch (e) {
            console.error(`❌ Error: ${e.message}`);
        }
    });

repoCmd
    .command('set-default-branch <repo> <branch>')
    .description('Set default branch for a repo')
    .action(async (repo, branch) => {
        try {
            await setDefaultBranch(repo, branch);
            console.log(`✅ Default branch set to "${branch}" for repo ${repo}`);
        } catch (e) {
            console.error(`❌ Error: ${e.message}`);
        }
    });

repoCmd
    .command('add-pusher <repo> <address>')
    .description('Add a pusher to a repository')
    .action(async (repo, addr) => {
        try {
            await addPusher(repo, addr);
            console.log(`✅ Added pusher ${addr} to repo ${repo}`);
        } catch (e) {
            console.error(`❌ Error: ${e.message}`);
        }
    });

repoCmd
    .command('remove-pusher <repo> <address>')
    .description('Remove a pusher from a repository')
    .action(async (repo, addr) => {
        try {
            await removePusher(repo, addr);
            console.log(`✅ Removed pusher ${addr} from repo ${repo}`);
        } catch (e) {
            console.error(`❌ Error: ${e.message}`);
        }
    });

repoCmd
    .command('add-maintainer <repo> <address>')
    .description('Add a maintainer to a repository')
    .action(async (repo, addr) => {
        try {
            await addMaintainer(repo, addr);
            console.log(`✅ Added maintainer ${addr} to repo ${repo}`);
        } catch (e) {
            console.error(`❌ Error: ${e.message}`);
        }
    });

export default repoCmd;
