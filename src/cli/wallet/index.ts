// manager wallet CLI
import chalk from "chalk";
import { Command } from "commander";
import { WalletManager } from "../../core/index.js";
import { promptPassword } from "./utils.js";
import { logger } from "../utils/log.js";

const walletCmd = new Command('wallet')
    .description('Manage Ethereum wallets');

// Create a new wallet
walletCmd
    .command('create')
    .description('Create a new private key wallet')
    .action(async () => {
        try {
            if (WalletManager.getDefaultAddress()) {
                return logger.error('Wallet already exists.');
            }

            const password = promptPassword('Enter password to encrypt wallet: ');
            const confirm = promptPassword('Confirm password: ');
            if (password !== confirm) {
                return logger.error('Passwords do not match.');
            }

            const { address, privateKey } = await WalletManager.createWallet(password);
            printWalletCreationSummary(address, privateKey);
        } catch (e: any) {
            logger.error(`Error: ${e.message}`);
            process.exit(1);
        }
    });

// Unlock wallet
walletCmd
    .command('unlock')
    .description('Unlock the wallet (cache decryption key)')
    .action(async () => {
        try {
            const address = WalletManager.getDefaultAddress();
            if (!address) {
                return logger.error("Wallet not found. Run 'goe wallet create' to create one.");
            }

            const password = promptPassword('Enter wallet password: ');
            await WalletManager.unlockWallet(address, password);
            logger.success(`Wallet ${address} unlocked. (Derived key restored in keychain)`);
        } catch (e: any) {
            logger.error(`Error: ${e.message}`);
            process.exit(1);
        }
    });

// Lock wallet
walletCmd
    .command('lock')
    .description('Lock the wallet (remove cached key)')
    .action(async () => {
        try {
            const address = WalletManager.getDefaultAddress();
            if (!address) {
                return logger.error("Wallet not found. Run 'goe wallet create' to create one.");
            }

            await WalletManager.lockWallet(address);
            logger.success(`Wallet ${address} locked. (Derived key removed from keychain).`);
        } catch (e: any) {
            logger.error(`Error: ${e.message}`);
            process.exit(1);
        }
    });

// List wallets
walletCmd
    .command('list')
    .description('List all wallet addresses')
    .action(async () => {
        const wallets = await WalletManager.listWalletsWithStatus();
        if (wallets.length === 0) {
            return logger.info('No wallets found. Create one with `goe wallet create`');
        }

        logger.info('Wallets:');
        for (const { address, unlocked } of wallets) {
            const statusColor = unlocked ? chalk.green : chalk.gray;
            logger.info(`- ${address} ${statusColor(unlocked ? '(🔓UNLOCKED)' : '(🔒LOCKED)')}`);
        }
    });

function printWalletCreationSummary(address: string, privateKey: string) {
    const redBold = chalk.redBright.bold;
    const gold = chalk.hex('#FFD700').bold;
    const whiteBold = chalk.black.bold;

    const cyanBright = chalk.cyanBright.bold;
    const styleAddress = cyanBright(address);
    const styledPrivateKey = redBold(privateKey);

    logger.success(`Wallet created successfully!\n`);

    logger.normal(`
${gold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}
${gold('🚨  CRITICAL WARNING & USAGE GUIDELINES  🚨')}
${gold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}

${whiteBold('💠 Wallet Address:')}
  ${styleAddress}

${whiteBold('🔑 Private Key (SAVE IMMEDIATELY!):')}
  ${styledPrivateKey}

${gold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}
${gold('📜  GOE Wallet Usage Policy')}
${gold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}

${gold('1️⃣  FUND GAS FIRST')}
  • Send a small amount of ${whiteBold('native gas token')} (e.g. ETH)  
    to this wallet before performing any operations.

${gold('2️⃣  LIMITED PURPOSE WALLET')}
  • This wallet is ${redBold('STRICTLY for GOE protocol data uploads')}  
    and contract interactions.
  • ${redBold('DO NOT')} store or transfer large funds here.

${gold('3️⃣  PRIVATE KEY SAFETY')}
  • ${redBold('NEVER')} share your private key with anyone.  
  • Losing this key = ${redBold('PERMANENT LOSS')} of access.  

${gold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}
`);
}

export default walletCmd;
