export function log(...args: any[]) {
    process.stderr.write(args.join(' ') + '\n');
}
