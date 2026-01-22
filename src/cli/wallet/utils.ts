import readlineSync from 'readline-sync';

export function promptPassword(message: string): string {
    if (process.env.GOE_TEST_MODE === '1') {
        const pwd = process.env.GOE_TEST_PASSWORD;
        if (!pwd) {
            throw new Error('GOE_TEST_PASSWORD not set');
        }
        return pwd;
    }

    return readlineSync.question(message, {
        hideEchoBack: true,
        mask: '*'
    });
}
