---
name: Test database circular foreign keys
description: How hand-written PostgreSQL test DDL should represent circular relationships.
---

Circular foreign keys in the hand-written test database may need one side
declared after table creation so both referenced tables already exist. Schema
drift validation must inspect those post-table constraints as well as inline
column references.

**Why:** PostgreSQL cannot create a foreign key to a table that has not been
created yet, while Drizzle schemas can express circular references directly.

**How to apply:** When adding a circular relation, keep the DDL executable by
adding one constraint after both tables exist and ensure the schema/test-DDL
drift checker compares its target column and delete action.