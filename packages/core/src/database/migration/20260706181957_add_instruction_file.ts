import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260706181957_add_instruction_file",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`instruction_file\` (
          \`session_id\` text NOT NULL,
          \`path\` text NOT NULL,
          \`content\` text NOT NULL,
          \`message_seq\` integer NOT NULL,
          \`discovered_seq\` integer NOT NULL,
          \`position\` integer NOT NULL,
          CONSTRAINT \`instruction_file_pk\` PRIMARY KEY(\`session_id\`, \`path\`),
          CONSTRAINT \`fk_instruction_file_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
