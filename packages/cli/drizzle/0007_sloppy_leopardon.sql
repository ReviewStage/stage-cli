ALTER TABLE `comment` ADD `authorAvatarUrl` text;--> statement-breakpoint
ALTER TABLE `comment` ADD `githubCommentId` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `comment_github_comment_id_idx` ON `comment` (`githubCommentId`);