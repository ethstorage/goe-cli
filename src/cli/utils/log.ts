import chalk from "chalk";

// 🧰 Utility log helpers
export function logInfo(msg: string) {
    console.log(chalk.blueBright(`📘 [${new Date().toLocaleTimeString()}] ${msg}`));
}

export function logSuccess(msg: string) {
    console.log(chalk.greenBright(`✅ [${new Date().toLocaleTimeString()}] ${msg}`));
}

export function logError(msg: string) {
    console.error(chalk.redBright(`❌ [${new Date().toLocaleTimeString()}] ${msg}`));
}
