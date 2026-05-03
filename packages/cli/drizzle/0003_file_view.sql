CREATE TABLE `file_view` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`userId` text DEFAULT 'local' NOT NULL,
	`runId` text NOT NULL,
	`filePath` text NOT NULL,
	FOREIGN KEY (`runId`) REFERENCES `chapter_run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_view_user_run_path_unique` ON `file_view` (`userId`,`runId`,`filePath`);