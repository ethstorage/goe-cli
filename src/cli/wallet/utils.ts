import readlineSync from 'readline-sync';

export function promptPassword(message: string): string {
    return readlineSync.question(message, {
        hideEchoBack: true,
        mask: '*'
    });
}
