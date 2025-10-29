// manager wallet CLI
import { program } from "commander";
import {
    createPrivateKeyWallet,
    listWalletAddresses,
    lockWallet,
    manualUnlockWallet
} from "../../core/wallet/index.js";
import { promptPassword } from "./utils/utils.js";
import { logInfo, logSuccess, logError } from "../utils/log.js";

const walletCmd = program.command('wallet').description('Manage Ethereum wallets');

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

            logSuccess(`Wallet created successfully!`);
            logInfo(`   Address: ${address}`);
            logError(`⚠️ IMPORTANT: Your private key is shown below. KEEP IT SAFE!`);
            logInfo(`   ${privateKey}\n`);
            logInfo(`💡 Please save your private key securely:
  - Do NOT share it with anyone.
  - Losing it means permanent loss of access to your wallet and funds.
  - Consider storing it in a secure password manager or offline safe location.`);
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
            logSuccess(`Wallet ${address} unlocked`);
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
            logSuccess(`Wallet ${address} locked`);
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

export default walletCmd;
