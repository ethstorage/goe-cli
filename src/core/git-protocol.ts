import { stdout } from 'node:process';
import { asyncMap } from 'rxjs-async-map'
import { rxToStream, streamToStringRx } from 'rxjs-stream'
import { filter, map, mergeMap, scan } from 'rxjs/operators'
import { Api, Command, GitCommands } from '../types/index.js';

const ONE_LINE_COMMANDS = [
  GitCommands.capabilities,
  GitCommands.option,
  GitCommands.list,
]

// --- Git Remote Helper Main ---
export default async function GitRemoteHelper({ stdin, api }: {
  stdin: NodeJS.ReadStream,
  api: Api
}) {
  const inputStream = streamToStringRx(stdin)
  const commands = inputStream.pipe(
      // The `line` can actually contain multiple lines, so we split them out into
      // multiple pieces and recombine them again
      map(line => line.split('\n')),
      mergeMap(lineGroup => lineGroup),
      // Commands include a trailing newline which we don't need
      map(line => line.trimEnd()),
      scan(
          (acc, line) => {
            // console.error('====')
            // console.error(line)
            // log('Scanning #NH7FyX', JSON.stringify({ acc, line }))
            // If we emitted the last value, then we ignore all of the current lines
            // and start fresh on the next "batch"
            const linesWaitingToBeEmitted = acc.emit ? [] : acc.lines

            // When we hit an empty line, it's always the completion of a command
            // block, so we always want to emit the lines we've been collecting.
            // NOTE: We do not add the blank line onto the existing array of lines
            // here, it gets dropped here.
            if (line === '') {
              if (linesWaitingToBeEmitted.length === 0) {
                return { emit: false, lines: [] }
              }

              return { emit: true, lines: linesWaitingToBeEmitted }
            }

            // Some commands emit one line at a time and so do not get buffered
            if (ONE_LINE_COMMANDS.find(command => line.startsWith(command))) {
              // If we have other lines waiting for emission, something went wrong
              if (linesWaitingToBeEmitted.length > 0) {
                console.error(
                    'Got one line command with lines waiting #ompfQK',
                    JSON.stringify({ linesWaitingToBeEmitted })
                )
                throw new Error('Got one line command with lines waiting #evVyYv')
              }

              return { emit: true, lines: [line] }
            }

            // Otherwise, this line is part of a multi line command, so stick it
            // into the "buffer" and do not emit
            return { emit: false, lines: linesWaitingToBeEmitted.concat(line) }
          },
          { emit: false, lines: [] as string[] }
      ),
      filter(acc => acc.emit),
      map(emitted => emitted.lines)
  )

  const capabilitiesResponse =
      [GitCommands.option, GitCommands.push, GitCommands.fetch]
          .filter(option => {
            if (option === GitCommands.option) {
              return true
            } else if (option === GitCommands.push) {
              return typeof api.handlePush === 'function'
            } else if (option === GitCommands.fetch) {
              return typeof api.handleFetch === 'function'
            } else {
              throw new Error('Unknown option #GDhBnb')
            }
          })
          .join('\n') + '\n\n'

  // NOTE: Splitting this into 2 pipelines so typescript is happy that it
  // produces a string
  const output = commands.pipe(
      map(
          (lines): Command => {
            const command = lines[0]

            if (command.startsWith('capabilities')) {
              return {command: GitCommands.capabilities}
            } else if (command.startsWith(GitCommands.list)) {
              return {
                command: GitCommands.list,
                forPush: command.startsWith('list for-push'),
              }
            } else if (command.startsWith(GitCommands.option)) {
              const [, key, value] = command.split(' ')
              return {command: GitCommands.option, key, value}
            } else if (command.startsWith(GitCommands.fetch)) {
              // Lines for fetch commands look like:
              // fetch sha1 branchName
              const refs = lines.map(line => {
                const [, oid, ref] = line.split(' ')
                return {oid, ref}
              })

              return {command: GitCommands.fetch, refs}
            } else if (command.startsWith(GitCommands.push)) {
              // Lines for push commands look like this (the + means force push):
              // push refs/heads/master:refs/heads/master
              // push +refs/heads/master:refs/heads/master
              const refs = lines.map(line => {
                // Strip the leading `push ` from the line
                const refsAndForce = line.slice(5)
                const force = refsAndForce[0] === '+'
                const refs = force ? refsAndForce.slice(1) : refsAndForce
                const [src, dst] = refs.split(':')
                return {src, dst, force}
              })
              return {command: GitCommands.push, refs}
            }

            throw new Error('Unknown command #Py9QTP')
          }
      ),
      asyncMap(async command => {
        if (command.command === GitCommands.capabilities) {
          return capabilitiesResponse
        } else if (command.command === GitCommands.option) {
          return 'ok\n'
        } else if (command.command === GitCommands.list) {
          const {forPush} = command
          return await api.list(forPush);
        } else if (command.command === GitCommands.push) {
          const {refs} = command
          return await api.handlePush(refs);
        } else if (command.command === GitCommands.fetch) {
          const {refs} = command
          return await api.handleFetch(refs)
        }

        throw new Error('Unrecognised command #e6nTnS')
      }, 1)
  );
  rxToStream(output).pipe(stdout);
}
