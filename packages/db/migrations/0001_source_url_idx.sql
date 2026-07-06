DROP INDEX IF EXISTS `articles_url_idx`;
CREATE UNIQUE INDEX `articles_source_url_idx` ON `articles` (`source_id`, `url`);
