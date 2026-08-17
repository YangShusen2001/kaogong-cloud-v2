-- 删除已被 styles 取代的遗留单值 style 列（见 docs/adr/0003）。
-- 0005 之前的记录仍可能只在 style 中保存样式，先回填再删列。
UPDATE `highlights`
SET `styles` = json_array(`style`)
WHERE `styles` = '[]' AND `style` <> '';
--> statement-breakpoint
ALTER TABLE `highlights` DROP COLUMN `style`;
