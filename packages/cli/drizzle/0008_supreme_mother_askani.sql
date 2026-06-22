DROP INDEX `comment_github_comment_id_idx`;--> statement-breakpoint
ALTER TABLE `comment` DROP COLUMN `authorAvatarUrl`;--> statement-breakpoint
ALTER TABLE `comment` DROP COLUMN `githubCommentId`;