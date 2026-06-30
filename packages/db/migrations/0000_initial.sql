CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`fetch_frequency` text DEFAULT 'daily' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_fetched_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

CREATE TABLE `articles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`title` text NOT NULL,
	`translated_title` text,
	`url` text NOT NULL,
	`published_at` integer,
	`fetched_at` integer NOT NULL,
	`metadata` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `sources_priority_idx` ON `sources` (`priority`);
CREATE UNIQUE INDEX `articles_url_idx` ON `articles` (`url`);
CREATE INDEX `articles_source_published_idx` ON `articles` (`source_id`, `published_at`);
