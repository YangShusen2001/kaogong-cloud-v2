-- Legacy email becomes a verified identity only when it matches the current QQ contract.
UPDATE `users`
SET `email` = CASE
	WHEN length(substr(lower(trim(`email`)), 1, instr(lower(trim(`email`)), '@') - 1)) BETWEEN 5 AND 11
		AND substr(lower(trim(`email`)), 1, 1) GLOB '[1-9]'
		AND substr(lower(trim(`email`)), 1, instr(lower(trim(`email`)), '@') - 1) NOT GLOB '*[^0-9]*'
		AND substr(lower(trim(`email`)), instr(lower(trim(`email`)), '@')) = '@qq.com'
	THEN lower(trim(`email`))
	ELSE ''
END;--> statement-breakpoint
-- No production users exist yet. Keep the oldest account, then the lowest stable id on ties.
WITH `ranked_emails` AS (
	SELECT
		`id`,
		row_number() OVER (
			PARTITION BY `email`
			ORDER BY `created_at`, `id`
		) AS `email_rank`
	FROM `users`
	WHERE `email` <> ''
)
UPDATE `users`
SET `email` = ''
WHERE `id` IN (
	SELECT `id` FROM `ranked_emails` WHERE `email_rank` > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX `users_verified_email_unique` ON `users` (`email`) WHERE "users"."email" <> '';
