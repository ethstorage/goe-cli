export function log(...args) {
    process.stderr.write(args.join(' ') + '\n');
}
