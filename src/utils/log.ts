export function log(msg: any) {
    console.error(msg.endsWith("\n") ? msg : msg + "\n")
}
