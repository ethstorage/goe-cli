#!/usr/bin/env node

import { program } from 'commander';
import walletCmd from "./wallet/index.js";
import repoCmd from "./repo/index.js";

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pkg = require("../../package.json");

program
    .version(pkg.version, '-v, --version')
    .description('Ethereum-backed Git remote helper & CLI');

program.addCommand(walletCmd);
program.addCommand(repoCmd);

program.parse(process.argv);
