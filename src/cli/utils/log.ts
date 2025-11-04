import chalk from "chalk";

function getTimestamp(): string {
    return new Date().toLocaleTimeString();
}

// 🧰 Utility log helpers
export const logger = {
    normal(msg: string) {
        console.log(`📘 [${getTimestamp()}] ${msg}`);
    },

    info(msg: string) {
        console.log(chalk.blueBright(`📘 [${getTimestamp()}] ${msg}`));
    },

    success(msg: string) {
        console.log(chalk.greenBright(`✅ [${getTimestamp()}] ${msg}`));
    },

    error(msg: string) {
        console.error(chalk.redBright(`❌ [${getTimestamp()}] ${msg}`));
    }
};
