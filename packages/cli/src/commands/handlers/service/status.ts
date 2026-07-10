import { EOL } from "os"
import { Effect } from "effect"
import { Service } from "@opencode-ai/client/effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.service.commands.status,
  Effect.fn("cli.service.status")(function* () {
    const options = yield* ServiceConfig.options()
    const found = yield* Service.status(options)
    process.stdout.write(JSON.stringify({ ...found, clientVersion: options.version }, null, 2) + EOL)
  }),
)
