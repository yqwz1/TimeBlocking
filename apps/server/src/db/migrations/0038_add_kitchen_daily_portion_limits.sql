ALTER TABLE `kitchen_foods` ADD `daily_max_portions` integer;
--> statement-breakpoint
UPDATE `kitchen_foods`
SET `daily_max_portions` = CASE
  WHEN lower(`name`) LIKE '%protein%milk%' THEN 2
  WHEN lower(`name`) LIKE '%ground%beef%' THEN 1
  WHEN lower(`name`) LIKE '%chicken%' THEN 1
  WHEN lower(`name`) LIKE '%tuna%' THEN 1
  ELSE `daily_max_portions`
END
WHERE lower(`name`) LIKE '%protein%milk%'
   OR lower(`name`) LIKE '%ground%beef%'
   OR lower(`name`) LIKE '%chicken%'
   OR lower(`name`) LIKE '%tuna%';
--> statement-breakpoint
UPDATE `kitchen_foods`
SET `daily_max_quantity` = 2
WHERE `unit` = 'scoop'
  AND (lower(`name`) LIKE '%protein%' OR lower(`name`) LIKE '%whey%');
