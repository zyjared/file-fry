import process from 'node:process'
import { program } from 'commander'

program
  .description('')
  .action(run)
  .parse(process.argv)

async function run(_options: Record<string, any>): Promise<void> {
//   title('')
//   info('[tip]', '请查看 package 中的指令')
}
