CREATE TABLE `chapter` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`runId` text NOT NULL,
	`externalId` text NOT NULL,
	`chapterIndex` integer NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`hunkRefs` text NOT NULL,
	`keyChanges` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`runId`) REFERENCES `chapter_run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chapter_run_idx_unique` ON `chapter` (`runId`,`chapterIndex`);--> statement-breakpoint
CREATE TABLE `chapter_run` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`repoRoot` text NOT NULL,
	`scopeKind` text NOT NULL,
	`workingTreeRef` text,
	`baseSha` text NOT NULL,
	`headSha` text NOT NULL,
	`mergeBaseSha` text NOT NULL,
	`generatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chapter_run_created_at_idx` ON `chapter_run` (`createdAt`);--> statement-breakpoint
CREATE TABLE `key_change` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`chapterId` text NOT NULL,
	`externalId` text NOT NULL,
	`keyChangeIndex` integer NOT NULL,
	`content` text NOT NULL,
	`lineRefs` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`chapterId`) REFERENCES `chapter`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `key_change_chapter_id_idx` ON `key_change` (`chapterId`);