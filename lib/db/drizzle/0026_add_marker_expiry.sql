ALTER TABLE "markers" ADD COLUMN "expires_at" timestamp;
CREATE INDEX "markers_expires_at_idx" ON "markers" USING btree ("expires_at");