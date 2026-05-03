CREATE TABLE `chapter_file_view` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`userId` text DEFAULT 'local' NOT NULL,
	`chapterId` text NOT NULL,
	`filePath` text NOT NULL,
	FOREIGN KEY (`chapterId`) REFERENCES `chapter`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chapter_file_view_chapter_id_idx` ON `chapter_file_view` (`chapterId`);--> statement-breakpoint
CREATE UNIQUE INDEX `chapter_file_view_user_chapter_path_unique` ON `chapter_file_view` (`userId`,`chapterId`,`filePath`);--> statement-breakpoint
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