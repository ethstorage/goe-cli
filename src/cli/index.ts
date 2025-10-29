#!/usr/bin/env node

import { program } from 'commander';
import pkg from '../../package.json' with { type: 'json' };
import walletCmd from "./wallet/index.js";
import repoCmd from "./repo/index.js";

program
    .version(pkg.version, '-v, --version')
    .description('Ethereum-backed Git remote helper & CLI');

program.addCommand(walletCmd);
program.addCommand(repoCmd);

program.parse(process.argv);
