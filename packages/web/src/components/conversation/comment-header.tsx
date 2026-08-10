import { UserName } from "@/components/shared/user-name";
import { type GitHubUser, getUserDisplay } from "@/components/shared/user-utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTimeAgo } from "@/lib/format";

interface CommentHeaderProps {
	user: GitHubUser;
	createdAt: string;
	updatedAt?: string;
	htmlUrl: string;
	size?: "sm" | "md";
	/** Icon rendered to the left of the username (replaces avatar when provided) */
	icon?: React.ReactNode;
	/** Rendered between username and time (e.g. "commented", "approved these changes") */
	action?: string;
	/** Avatar URL of the GitHub App that created this comment on behalf of the user. */
	appAvatarUrl?: string;
	/** URL of the GitHub App (e.g. https://github.com/apps/{slug}). */
	appUrl?: string;
	/** Rendered inline after the timestamp (e.g. a "Pending" label, a bot badge) */
	badge?: React.ReactElement | string | number | null;
	/** Rendered on the right side of the header row (e.g. a copy-link button) */
	headerAction?: React.ReactNode;
	/** Rendered below the header row (e.g. CommentBody, nested comments) */
	children?: React.ReactNode;
}

export function CommentHeader({
	user,
	createdAt,
	updatedAt,
	htmlUrl,
	size = "md",
	icon,
	action,
	appAvatarUrl,
	appUrl,
	badge,
	headerAction,
	children,
}: CommentHeaderProps) {
	const isSm = size === "sm";
	const avatarCn = isSm ? "size-6" : "size-8";
	const fallbackCn = isSm ? "text-[0.625rem]" : "text-xs";
	const headerMbCn = isSm ? "mb-0.5" : "mb-1";
	const textCn = isSm ? "text-xs" : "text-sm";
	const { profileUrl } = getUserDisplay(user);

	return (
		<div className="flex items-start gap-3">
			<div className="relative shrink-0">
				<a href={profileUrl} target="_blank" rel="noopener noreferrer">
					<Avatar className={avatarCn}>
						<AvatarImage src={user.avatar_url} alt={user.login} />
						<AvatarFallback className={fallbackCn}>{user.login[0]?.toUpperCase()}</AvatarFallback>
					</Avatar>
				</a>
				{appAvatarUrl && user.type !== "Bot" && (
					<a
						href={appUrl ?? profileUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="-bottom-1 -right-1 absolute"
					>
						<img src={appAvatarUrl} alt="" className="size-5 rounded-full border-2 border-card" />
					</a>
				)}
			</div>
			<div className="min-w-0 flex-1">
				<div className={`flex items-center gap-2 ${headerMbCn}`}>
					<p className={`min-w-0 flex-1 ${textCn} text-muted-foreground`}>
						{icon && <span className="mr-1.5 inline-flex align-middle">{icon}</span>}
						<UserName user={user} />
						{action && <> {action}</>}{" "}
						<span className="text-muted-foreground">
							<a
								href={htmlUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="hover:underline"
							>
								<time dateTime={createdAt} title={new Date(createdAt).toLocaleString()}>
									{formatTimeAgo(createdAt)}
								</time>
							</a>
							{updatedAt && updatedAt !== createdAt && (
								<Tooltip>
									<TooltipTrigger asChild>
										<span className="ml-1 cursor-default">(edited)</span>
									</TooltipTrigger>
									<TooltipContent>Edited {new Date(updatedAt).toLocaleString()}</TooltipContent>
								</Tooltip>
							)}
						</span>
						{badge && <> {badge}</>}
					</p>
					{headerAction && <div className="shrink-0">{headerAction}</div>}
				</div>
				{children}
			</div>
		</div>
	);
}
