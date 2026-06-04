DROP INDEX IF EXISTS `event_aggregate_seq_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `event_aggregate_type_seq_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `session_message_session_seq_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `session_message_session_time_created_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `session_message_time_created_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `event_aggregate_seq_idx` ON `event` (`aggregate_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_message_session_seq_idx` ON `session_message` (`session_id`,`seq`);
