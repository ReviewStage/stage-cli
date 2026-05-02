CREATE TABLE `chapter_view` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`userId` text DEFAULT 'local' NOT NULL,
	`chapterId` text NOT NULL,
	FOREIGN KEY (`chapterId`) REFERENCES `chapter`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chapter_view_user_chapter_unique` ON `chapter_view` (`userId`,`chapterId`);--> statement-breakpoint
CREATE TABLE `key_change_view` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`userId` text DEFAULT 'local' NOT NULL,
	`keyChangeId` text NOT NULL,
	FOREIGN KEY (`keyChangeId`) REFERENCES `key_change`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `key_change_view_key_change_id_idx` ON `key_change_view` (`keyChangeId`);--> statement-breakpoint
CREATE UNIQUE INDEX `key_change_view_user_key_change_unique` ON `key_change_view` (`userId`,`keyChangeId`);