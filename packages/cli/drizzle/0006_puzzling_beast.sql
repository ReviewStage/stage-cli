CREATE TABLE `comment` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`threadId` text NOT NULL,
	`authorId` text DEFAULT 'local' NOT NULL,
	`body` text NOT NULL,
	FOREIGN KEY (`threadId`) REFERENCES `comment_thread`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comment_thread_id_idx` ON `comment` (`threadId`);--> statement-breakpoint
CREATE TABLE `comment_thread` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`scopeKey` text NOT NULL,
	`filePath` text NOT NULL,
	`side` text NOT NULL,
	`startLine` integer NOT NULL,
	`endLine` integer NOT NULL,
	`resolvedAt` integer
);
--> statement-breakpoint
CREATE INDEX `comment_thread_scope_key_idx` ON `comment_thread` (`scopeKey`);