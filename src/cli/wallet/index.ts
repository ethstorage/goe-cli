// manager wallet CLI
import chalk from "chalk";
import { Command } from "commander";
import {
    createPrivateKeyWallet,
    listWalletAddresses,
    lockWallet,
    manualUnlockWallet
} from "../../core/wallet/index.js";
import { promptPassword } from "./utils/utils.js";
import { logInfo, logSuccess, logError } from "../utils/log.js";

const walletCmd = new Command('wallet')
    .description('Manage Ethereum wallets');

function getFirstWalletAddress(): string | null {
    const addresses = listWalletAddresses();
    return addresses.length > 0 ? addresses[0] : null;
}

// Create a new wallet
walletCmd
    .command('create')
    .description('Create a new private key wallet')
    .action(async () => {
        try {
            const addresses = listWalletAddresses();
            if (addresses && addresses.length > 0) {
                return logError('Wallet already exists.');
            }

            const password = promptPassword('Enter password to encrypt wallet: ');
            const confirm = promptPassword('Confirm password: ');
            if (password !== confirm) {
                return logError('Passwords do not match.');
            }

            const { address, privateKey } = await createPrivateKeyWallet(password);
            printWalletCreationSummary(address, privateKey);
        } catch (e: any) {
            logError(`Error: ${e.message}`);
            process.exit(1);
        }
    });

// Unlock wallet
walletCmd
    .command('unlock')
    .description('Unlock the wallet (cache decryption key)')
    .action(async () => {
        try {
            const address = getFirstWalletAddress();
            if (!address) {
                return logError("Wallet not found. Run 'eths wallet create' to create one.");
            }

            const password = promptPassword('Enter wallet password: ');
            await manualUnlockWallet(address, password);
            logSuccess(`Wallet ${address} unlocked. (Derived key restored in keychain)`);
        } catch (e: any) {
            logError(`Error: ${e.message}`);
            process.exit(1);
        }
    });

// Lock wallet
walletCmd
    .command('lock')
    .description('Lock the wallet (remove cached key)')
    .action(async () => {
        try {
            const address = getFirstWalletAddress();
            if (!address) {
                return logError("Wallet not found. Run 'eths wallet create' to create one.");
            }

            await lockWallet(address);
            logSuccess(`Wallet ${address} locked. (Derived key removed from keychain).`);
        } catch (e: any) {
            logError(`Error: ${e.message}`);
            process.exit(1);
        }
    });

// List wallets
walletCmd
    .command('list')
    .description('List all wallet addresses')
    .action(() => {
        const addresses = listWalletAddresses();
        if (addresses.length === 0) {
            return logInfo('No wallets found. Create one with `eths wallet create`');
        }
        logInfo('Wallets:');
        addresses.forEach(addr => logInfo(`- ${addr}`));
    });

export function printWalletCreationSummary(address: string, privateKey: string) {
    const redBold = chalk.redBright.bold;
    const gold = chalk.hex('#FFD700').bold;
    const whiteBold = chalk.black.bold;
    const styledPrivateKey = chalk.redBright.bold(privateKey);

    logSuccess(`Wallet created successfully!\n`);

    console.log(`
${gold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}
${gold('🚨  CRITICAL WARNING & USAGE GUIDELINES  🚨')}
${gold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}

${whiteBold('💠 Wallet Address:')}
  ${chalk.cyanBright(address)}

${whiteBold('🔑 Private Key (SAVE IMMEDIATELY!):')}
  ${styledPrivateKey}

${gold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}
${gold('📜  ETHS Wallet Usage Policy')}
${gold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}

${gold('1️⃣  FUND GAS FIRST')}
  • Send a small amount of ${whiteBold('native gas token')} (e.g. ETH)  
    to this wallet before performing any operations.

${gold('2️⃣  LIMITED PURPOSE WALLET')}
  • This wallet is ${redBold('STRICTLY for ETHS protocol data uploads')}  
    and contract interactions.
  • ${redBold('DO NOT')} store or transfer large funds here.

${gold('3️⃣  PRIVATE KEY SAFETY')}
  • ${redBold('NEVER')} share your private key with anyone.  
  • Losing this key = ${redBold('PERMANENT LOSS')} of access.  

${gold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}
`);
}

export default walletCmd;
