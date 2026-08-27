ALTER TABLE "documents"
ADD COLUMN "category" TEXT NOT NULL DEFAULT 'product';

UPDATE "documents"
SET "category" = CASE
  WHEN "filename" ~* '(设计|视觉|组件|样式|交互)' OR "filename" ~* '(^|[^a-z0-9])(ui|ux)([^a-z0-9]|$)' THEN 'design'
  WHEN "filename" ~* '(员工|人事|考勤|绩效|福利|招聘|薪酬)' THEN 'hr'
  WHEN "filename" ~* '(销售|市场|客户|报价|商务|营销)' THEN 'sales'
  WHEN "filename" ~* '(技术|架构|接口|开发|数据库|安全|部署|运维|代码|规范)' OR "filename" ~* '(^|[^a-z0-9])api([^a-z0-9]|$)' THEN 'engineering'
  ELSE 'product'
END;
